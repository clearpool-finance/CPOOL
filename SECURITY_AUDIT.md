# CPOOL — Security Audit (round 1)

Auditor: Claude Code (agent)
Date: 2026-04-24
Branch: `security/audit-round-1` off `main` (parent: `1eabeb5`)

## Methodology

1. Enumerated all Solidity sources under `contracts/` (3 files, 543 LoC).
2. Mapped the deployment model from `scripts/deploy.js`, `deployments/mainnet/`,
   `hardhat.config.js`: contracts are immutable, deployed once, no proxy.
3. Mapped the role/auth surface: `Ownable` (OZ v4.9.6) on `Vesting` and
   `AutoVesting`; `CPOOL` is ownerless with a fixed supply minted to a single
   multisig at construction.
4. Walked the primary value flows end-to-end:
   - CPOOL transfer / approve / transferFrom / delegate / delegateBySig
   - Vesting: `holdTokens` → `claim` (time-weighted streaming release)
   - AutoVesting: `holdTokens` → `claim` (batched, multi-entry per recipient)
5. For each flow, enumerated happy path plus: reentrancy, CEI ordering,
   fee-on-transfer / rebasing assumptions, zero-address checks, unbounded
   loops over user- or owner-controlled arrays, rounding, first-depositor,
   integer-type overflow in loop counters, access control on state-mutating
   entry points, signature replay (cross-chain and cross-fork).
6. Reproduced every reported bug with a failing test before fixing, and
   re-ran the full suite (`npx hardhat test`) after each fix.

## Scope

| Contract | LoC | Solidity | Notes |
|----------|-----|----------|-------|
| `contracts/CPOOL.sol` | 302 | ^0.8.4 | Compound-style governance token, 1B fixed supply, `uint96` balances, EIP-712 `delegateBySig` |
| `contracts/Vesting.sol` | 81 | ^0.8.4 | Linear vester, one allocation per recipient, `Ownable` |
| `contracts/AutoVesting.sol` | 160 | ^0.8.4 | Batch vester, multiple vesting IDs per recipient, `Ownable` |
| **Total** | **543** | | |

Compiler configured in `hardhat.config.js` at 0.8.4 with optimizer runs=200.
Tests: Hardhat + Waffle + ethers v5, 38 tests prior to audit, all passing.

Out of scope: deployed multisig key management, off-chain tooling, the
`CPOOL-1` folder under `deployments/` (not a contract).

---

## Findings

### [HIGH] AutoVesting.claim / holdTokens / getAvailableBalanceOf — `uint8` loop counter overflows at 256 entries, permanently bricking claim — `contracts/AutoVesting.sol:66`, `:85`, `:90`, `:101`

**Bug.** Four loops use `uint8 i` to iterate structures whose lengths are
owner-controlled and can exceed 255:

- `claim` — `for (uint8 i = 0; i < vestingIds[account].length; i++)` at line 66
- `holdTokens` — two `uint8` loops over `params` at lines 85 and 90
- `getAvailableBalanceOf` — `uint8 i` loop at line 101

`vestingIds[account]` grows every time the owner calls `holdTokens` with that
recipient (line 156 `vestingIds[params.recipient].push(_nextVestingId)`), and
there is no deduplication or cap. Once the length reaches 256, the `i++` on
`i == 255` overflows `uint8` and triggers a Solidity 0.8.x arithmetic Panic
(0x11), aborting the call. `claim` and `getAvailableBalanceOf` then revert
for every subsequent invocation for that account — all of that user's vested
tokens are permanently stuck in the contract.

**Attack.**
1. Owner (honest or compromised) distributes many small vesting grants over
   time, e.g. a quarterly allocation schedule, a community airdrop program,
   or a contributor with many rounds. Reaching 256 entries for a single
   address is routine over a multi-year vesting program.
2. On the 256th grant, `holdTokens` successfully pushes ID #255 into
   `vestingIds[recipient]` (within the onlyOwner batch; each batch uses its
   own `uint8` bound so owner stays ≤ 255 per call — but the array can cross
   256 across multiple batches).
3. Victim calls `claim(self)`. Loop iterates `i = 0..255`. On `i == 255`
   the increment `i++` panics. Revert.
4. All further `claim` and `getAvailableBalanceOf(victim)` calls revert
   identically. Tokens held by the contract on behalf of the victim are
   unreachable — no admin rescue path exists.

Reproduced with `test/SecurityFindings.js`; unfixed contract reverts with
`panic code 0x11 (Arithmetic operation underflowed or overflowed outside of
an unchecked block)`.

**Fix.** Widen the counters to `uint256` and cache `array.length` / `ids`
locally for gas. Solidity style guide — Solidity docs on
[integer types and loops](https://docs.soliditylang.org/en/v0.8.4/types.html#integers)
— using the natural word size avoids this entire class of mistake; Trail of
Bits' [Building Secure Contracts — loops](https://secure-contracts.com/learn_evm/loops.html)
and SWC-101 (integer overflow/underflow) explicitly flag narrow counters
with user/owner-controlled bounds.

**Status.** Applied (commit in this PR). Regression test added at
`test/SecurityFindings.js`. Full suite: 39/39 passing.

---

### [LOW] AutoVesting — `totalVest` accounting diverges from actual vault holdings — `contracts/AutoVesting.sol:89`, missing decrement in `claim`

**Bug.**
- Line 89: `totalVest += totalAmount` where `totalAmount = Σ params[i].amount`,
  which includes the `unlocked` portion that is immediately transferred out
  at line 147. Therefore `totalVest` is increased even for tokens that never
  stay in the vault.
- `claim` at line 64 never decrements `totalVest` after transferring tokens
  out. Over time the accumulated `totalVest` diverges arbitrarily far from
  the actual contract balance.

Contrast with `Vesting.sol:45` which adds only the locked amount and
`Vesting.sol:63` which decrements `totalVest -= amount` on claim.

**Attack.** None — `totalVest` is not used in any require check or
transfer-sizing decision in `AutoVesting`. Impact is limited to external
observers (subgraphs, dashboards, auditors) reading the value and being
misled about outstanding liabilities.

**Fix.** Either (a) remove `totalVest` from `AutoVesting` altogether since
it is unused, or (b) increment by the locked portion only and decrement in
`claim`. Best-practice citation: OpenZeppelin's
[VestingWallet](https://docs.openzeppelin.com/contracts/5.x/api/finance#VestingWallet)
exposes `released()` and `releasable()` but not a synthetic running total,
for exactly this reason.

**Status.** Recommended — not applied. This is a reporting-only issue and
fixing it changes the public ABI (`totalVest` is a `public` state variable).
Flag for the next deploy; not worth a hot-patch.

---

### [LOW] AutoVesting._holdTokens — unchecked return on `cpool.transfer` for the unlocked tranche — `contracts/AutoVesting.sol:147`

**Bug.** `cpool.transfer(params.recipient, params.unlocked)` has its return
value ignored, while the sibling `cpool.transfer` in `claim` (line 74) and
`cpool.transferFrom` in `holdTokens` (line 88) are wrapped in `require`.

**Attack.** Not reachable in production with the immutable `CPOOL` token:
CPOOL's `_transferTokens` (lines 233–242) always reverts on failure, never
returns false. However, the code is brittle against future redeployment
against a non-reverting non-compliant ERC-20. Severity capped at LOW
because the constructor at line 52 takes `IERC20 cpool_` — the owner picks
the token — and the known deploy target reverts on failure.

**Fix.** Wrap in `require(..., "…")` like the other two calls in the same
file, or use OpenZeppelin's
[`SafeERC20.safeTransfer`](https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20)
(v4.9.6 is already a dependency via `@openzeppelin/contracts`). SWC-104
(Unchecked Call Return Value) / Consensys "Token integration checklist" both
call this out.

**Status.** Recommended — not applied in this round because (a) no reachable
attack against the current deploy, (b) the fix alters emit/event ordering
and I want to keep this round's diff surgical.

---

### [LOW / Informational] Vesting.claim — public entry point permits third-party claim trigger (grief-lite) — `contracts/Vesting.sol:56`

**Bug.** `claim(address recipient_)` has no auth — any caller can invoke it
against any recipient. The recipient is the `transfer` destination, so
tokens are delivered to the intended owner; no funds can be stolen. The
streaming formula at line 76 uses `amount * (block.timestamp - lastUpdate)
/ (vestingEnd - vestingBegin)`, and each claim advances `lastUpdate`.

Where this could matter: if `amount / (vestingEnd - vestingBegin)` is
extremely small (under ~1 token-wei per second), an attacker could call
claim at near-zero intervals and each call would floor-round to zero while
still advancing `lastUpdate`, preventing any meaningful partial claim until
`block.timestamp >= vestingEnd`, at which point the `amount - claimed`
branch releases the full remainder in one go.

**Attack.** For realistic CPOOL allocations (18 decimals, grants in the
thousands/millions of whole tokens over 1 year), the per-second increment
is ≥ 1e13 wei — not exploitable. For micro-allocations in a small token,
the grief forces the recipient to wait until `vestingEnd` for any tokens.
No fund loss; not escalated.

**Fix (recommended).** Either restrict to `recipient_ == msg.sender`, or
cap the per-call rounding loss, or document that the formula's rounding is
acceptable. OpenZeppelin's
[VestingWallet `release()`](https://docs.openzeppelin.com/contracts/5.x/api/finance#VestingWallet-release--)
uses `beneficiary()` as the sole transfer destination but lets anyone call
it, precisely because `transfer` goes to the beneficiary — same pattern as
here, so this is arguably accepted-risk.

**Status.** Accepted risk — documented. No code change.

---

### [Informational] AutoVesting.holdTokens — no deduplication when creating vesting IDs for the same recipient — `contracts/AutoVesting.sol:156`

**Bug.** Each call pushes to `vestingIds[recipient]`. Combined with the
`uint8` counter bug above, this is the *mechanism* by which the array grows.
Even with the fix (uint256 counter), very large vesting ID lists will
eventually hit block-gas-limit DoS for `claim`. Solidity docs —
[Gas limits and loops](https://docs.soliditylang.org/en/v0.8.4/security-considerations.html#gas-limit-and-loops)
— recommend explicit per-call caps or pull-style claim per ID.

**Attack.** Not exploitable by an untrusted party; owner-only.

**Fix (future work).** Expose a `claimById(uint256 id)` variant that claims
a single vesting entry, so users aren't forced through the full loop. Keep
the aggregated `claim` for convenience at small N.

**Status.** Recommended for a future release, not this round.

---

## Verified-clean (flows and classes explicitly checked and found safe)

- **CPOOL `delegateBySig` replay.** `delegateBySig` (`CPOOL.sol:161`) binds
  the EIP-712 domain with `getChainId()` (line 162) and consumes a per-user
  nonce (`nonces[signatory]++`, line 167). Cross-chain and cross-fork replay
  both prevented. Expiry check at line 168 bounds the signature lifetime.
  Matches the [EIP-712 specification](https://eips.ethereum.org/EIPS/eip-712)
  and OpenZeppelin's
  [`ERC20Votes`](https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#ERC20Votes)
  reference implementation.
- **CPOOL `transferFrom` allowance handling.** `type(uint96).max` is the
  infinite-approval sentinel (line 133) — approvals at that value are not
  decremented, matching Compound COMP's original design. Non-zero finite
  approvals decrement correctly via `sub96` with explicit underflow check
  (line 291).
- **CPOOL checkpoint binary search (`getPriorVotes`).** Standard Compound
  algorithm, well reviewed; `fromBlock` is `uint32` with a bounds check at
  line 275; block-number is only truncated in `_writeCheckpoint`.
- **Vesting fund safety.** `holdTokens` checks
  `totalVest + amount_ <= CPOOL.balanceOf(address(this))` at line 42 — no
  over-allocation possible. `claim` decrements `totalVest` symmetrically
  at line 63. Streaming math conserves tokens: the `>= vestingEnd` branch
  (line 73–74) releases `amount - claimed` exactly, preventing rounding
  drift from causing loss.
- **Reentrancy.** All three contracts use the in-repo `CPOOL` token (or an
  arbitrary ERC-20 passed by the owner at deploy). CPOOL itself does no
  callbacks to sender/receiver. No external calls to untrusted receivers on
  any user-reachable path in `Vesting` or `AutoVesting` beyond the
  `cpool.transfer` at claim end. CEI is respected in `Vesting.claim`
  (state updated lines 61–63 before `transfer` at 64) and in
  `AutoVesting.claim` (state updated in loop before `transfer` at line 74).
- **Zero-address / zero-amount.** CPOOL blocks transfers to / from
  `address(0)` explicitly at `_transferTokens:234–235`. AutoVesting rejects
  zero-amount vesting at `_holdTokens:141`.
- **First-depositor / share inflation.** Not applicable — neither contract
  is a share-based vault.
- **Upgradeability hazards.** None — all contracts are immutable (no proxy,
  no initializer). Storage-collision and uninitialized-implementation
  issues do not apply.
- **Cross-chain / bridge surface.** None in scope.

## Out of scope / deferred

- Multisig operational security (the CPOOL constructor mints the entire
  1,000,000,000e18 supply to one address — that address's key management is
  the security ceiling for the whole protocol).
- `scripts/deploy.js` and deployment artefacts — not reviewed for
  correctness of deployed addresses.
- Any off-chain governance or voting UI that consumes the vote checkpoints.

## Shipping order

1. **HIGH: uint8 loop counter fix in AutoVesting.** Ship now — shipped in
   this PR, test coverage added.
2. **LOW: AutoVesting.totalVest accounting.** Next deploy. Requires
   re-deploy because `totalVest` is immutable on-chain state.
3. **LOW: AutoVesting._holdTokens unchecked transfer.** Next deploy.
   Switch to `SafeERC20` project-wide.
4. **Informational: pull-style per-ID claim in AutoVesting.** Next feature
   release, once the user count grows to where the block-gas-limit risk is
   material.

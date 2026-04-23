# CPOOL — Security Audit Round 2 Validation

Date: 2026-04-24
Branch: `security/audit-round-1`
Fix commit validated: `a5ef004`

## Methodology

1. Re-read every cited source line on the current tree. Line numbers drifted after the fix; I re-resolved each finding against both pre-fix (`1eabeb5:contracts/AutoVesting.sol`) and post-fix (`a5ef004:contracts/AutoVesting.sol`).
2. Reproduced the HIGH pre-fix by checking out the old `AutoVesting.sol` and running `test/SecurityFindings.js` — reverts with `panic code 0x11`. Restored the fix and re-ran the full suite: **39/39 passing**.
3. Tried to construct counter-examples (owner-side dedup, cap, alternative claim path) that would make 256 entries unreachable — none exist.
4. WebFetch'd every citation to confirm it says what the agent claims.

## Confirmed

- **[HIGH] uint8 loop counter overflow — CONFIRMED, fix is correct.**
  - Solidity 0.8.x does panic (0x11) on `i++` when `i == type(uint8).max`; arithmetic on narrow ints is checked the same as `uint256`. Verified by executing the pre-fix regression test — it reverts with exactly panic 0x11.
  - Pre-fix site count is accurate: `claim` (old L66), `holdTokens` ×2 (old L85/L90), `getAvailableBalanceOf` (old L101). No other claim path exists — `getAvailableBalance(id)` is O(1) and takes an ID, not an account, so `getAvailableBalanceOf` is the only aggregator. Confirmed all claim paths fixed.
  - **No owner-side cap or dedup exists** to stop the array growing. `_holdTokens` unconditionally pushes on L161 on every call where `unlocked < amount`. Reaching 256 is realistic over a multi-year schedule (the agent's attack model is sound).
  - Fix (`a5ef004`) widens all four counters to `uint256` and caches `ids`/`len`. No behavior change within the previously-working range. No bypass found.
  - Regression test asserts `claim` succeeds at 260 entries. I attempted the counter-example that the test bypasses `holdTokens`' own uint8 loop by batching ≤200 per call — this is correct and honest; the test correctly isolates the claim-side overflow.
  - Full suite passes post-fix (39/39).

- **[LOW] `totalVest` accounting drift — CONFIRMED.** L92 `totalVest += totalAmount` (uses gross, not locked), and `claim` never decrements. Contrast with `Vesting.sol:45` / `Vesting.sol:63`. `totalVest` is genuinely unused in any require/transfer decision in `AutoVesting`, so impact is reporting-only. Severity LOW is accurate.

- **[LOW] `_holdTokens` unchecked `cpool.transfer` — CONFIRMED.** L152 lacks `require`, while sibling calls at L76 and L91 have `require`. Against the deployed CPOOL token this is unreachable because `_transferTokens` reverts on failure, but the inconsistency is real. Severity LOW is accurate; Status "recommended, not applied" is a reasonable call.

- **[LOW/Informational] Vesting.claim grief-lite — CONFIRMED & accurately downgraded.** Matches the OZ VestingWallet pattern (anyone can call `release()` because funds go to the beneficiary). For realistic 18-decimal allocations the rounding loss is non-issue. Accepted-risk is correct.

- **[Informational] No dedup / unbounded list growth — CONFIRMED.** Still a block-gas-limit concern at very high N even post-fix. Non-exploitable by third parties (owner-only growth). Recommending per-ID claim is sound.

- **Verified-clean claims — spot-checked, all accurate:**
  - `delegateBySig` chainId + per-user nonce + expiry: lines 162/167/168 confirmed.
  - `type(uint96).max` infinite-approval sentinel: L133 confirmed.
  - `Vesting.holdTokens` balance guard and `claim` symmetric decrement: L42/L63 confirmed.
  - Zero-address guards at `_transferTokens:234–235` confirmed.
  - EIP-712 citation fetches cleanly and says what the agent claims.

## Over-stated

- **Trail of Bits "Building Secure Contracts — loops" citation** (`https://secure-contracts.com/learn_evm/loops.html`) **does not resolve** (404) and the site's TOC does not show a dedicated loops page. The narrow-counter claim is still trivially true (it is just Solidity arithmetic + SWC-101), but this specific URL is unverifiable and should be removed or replaced. Not a correctness issue with the finding itself — only the citation.
- **SWC-101 / SWC-104 citations**: registry returns 403 to automated fetchers so I cannot machine-verify, but the IDs and titles are standard and well-known (SWC-101 = Integer Overflow/Underflow, SWC-104 = Unchecked Call Return Value). Accept.
- Line-number drift: the audit cites `_holdTokens:141` for the zero-amount check; actual line is 146. The `_transferTokens:233–242` cited range is actually 233–242 but the zero-address checks are on 234–235 (the agent notes this correctly later). These are cosmetic.

## Retracted

- None. No finding is fabricated or wrong in substance.

## New findings from validation

- **Citation hygiene**: one cited URL (Trail of Bits loops page) does not exist. Replace with the concrete primary source (Solidity 0.8 release notes on checked arithmetic, or SWC-101) before circulating externally.
- **Test coverage gap (non-blocking)**: `test/SecurityFindings.js` only asserts `claim` succeeds at 260 entries. It does not exercise `getAvailableBalanceOf` (view) or `holdTokens` at the boundary. They share the same fix and were trivially verified by code inspection, but adding a one-line `await vesting.getAvailableBalanceOf(user.address)` before the `claim` assertion would harden the regression. Not severe enough to block the PR.
- **`totalVest` is `public` state** — the agent flagged that fixing it changes the ABI, which is correct. Worth explicitly noting that consumers (subgraph, Dune) may already depend on the (broken) value; coordinate before the next deploy.

## Verdict

The Round-1 HIGH is real, the fix is correct, and the regression test proves both revert-before / pass-after. The three LOW findings and two Informational findings are all accurate as stated. The only defect in the report is one dead citation URL.

Ship `a5ef004`.

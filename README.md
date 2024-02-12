# CPOOL

## Compile

Copy `example.env` to a new file called `.env` and fill the values in it.

```
npx hardhat compile
```

## Test

```
npx hardhat test
```

## Deploy

```
npx hardhat run scripts/deploy.js --network [Your Network]
```
# CPOOL

Token Parameter | Value
------------ | -------------
Token name	| Clearpool
Symbol 	 | CPOOL
Decimals |	18
Total Supply | 1 000 000 000

# Vesting

### Hold Tokens

To hold tokens for some recipient - firstly tokens should be transferred to Vesting Contract and then Vesting Contract's owner should use function holdTokens

```jsx
function holdTokens(
        address recipient_,
        uint amount_,
        uint vestingBegin_,
        uint vestingCliff_
        uint vestingEnd_
    )
```

**Parameters**

- address recipient\_ - recipient's address
- uint amount\_ - amount that should be vested
- uint vestingBegin\_ - timestamp of the beginning of vesting
- uint vestingCliff\_ - timestamp of the end of the Cliff (since this moment tokens become available to claim)
- uint vestingEnd\_ - timestamp of the end of the vesting

### Claim Tokens

```jsx
function claim(address recipient_
```

_function to claim tokens_

## Getters

```jsx
function getAvailableBalance(address recipient_) public view returns(uint)
```

_returns amount available to claim for user_

```jsx
mapping (address => VestingParams) public recipients;
```

_returns structure with following params_:

- amount - initial amount of Vested tokens
- uint vestingBegin\_ - timestamp of the beginning of vesting
- uint vestingCliff\_ - timestamp of the end of the Cliff (since this moment tokens become available to claim)
- uint vestingEnd\_ - timestamp of the end of the vesting
- lastUpdate - timeStamp of last claim
- claimed - token's amount that was already claimed

# AutoVesting

### Hold Tokens

Used to transfer tokens to the contract and hold tokens to a batch of accounts. 
Only owner can call this function.

```jsx
function holdTokens(HoldParams[] memory params) external
```
**Parameters**
- params: an array of HoldParams structure. The structure contains:
  - address recipient - recipient's address
  - uint256 amount - amount that should be vested
  - uint256 unlocked - the number of tokens transferred to accounts immediately
  - uint256 vestingCliff - timestamp of the end of the Cliff (since this moment tokens become available to claim)


### Claim Tokens

```jsx
function claim(address account) external
```

_function to claim unclaimed tokens_

## Getters

```jsx
function getAvailableBalance(address account) public view returns(uint)
```

_returns the amount of tokens available to claim for the given account_

```jsx
mapping (address => VestingParams) public vestings;
```

_returns structure with following params for the given address_:

- amount - initial amount of Vested tokens
- vestingCliff - timestamp of the end of the Cliff (since this moment tokens become available to claim)
- lastUpdate - timeStamp of last claim
- claimed - token's amount that was already claimed

```jsx
mapping(address => uint256[]) public vestingIds;
```
_Mapping of addresses to lists of their vesting IDs. Returns the list of vesting IDs for the given address._

```jsx
uint256 public immutable vestingBegin;
```
_Timestamp of the vesting begin time_

```jsx
uint256 public immutable vestingEnd;
```
_Timestamp of the vesting end time_
```jsx
uint256 public totalVest;
```
_Total amount of vested tokens_

```jsx
IERC20 public immutable cpool;
```
_CPOOL token contract_
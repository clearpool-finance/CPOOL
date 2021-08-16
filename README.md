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
---
name: contract-solidity
description: 스마트 컨트랙트(Solidity) 보안 규범. Checks-Effects-Interactions, modifier 기반 접근제어, 상태전환 중앙함수, 이벤트 emit, 크로스체인 수신 검증. .sol 작업 시 로드.
---

# 스마트 컨트랙트 (Solidity)

## 5개 핵심 규칙

```
1. 외부 컨트랙트 호출은 반드시 마지막에 (Checks-Effects-Interactions)
2. msg.sender 검증은 modifier로 분리, 함수 본문에 인라인 금지
3. 금액 계산은 uint256만, 절대 int 혼용 금지
4. 이벤트는 모든 상태 변경마다 반드시 emit
5. 컨트랙트 하나당 책임 하나 (Registry, Vault, Logic 분리)
```

## 절대 쓰지 말 것

```
- tx.origin (msg.sender만 사용)
- block.timestamp 단독 난수 (조작 가능)
- delegatecall (storage 레이아웃 충돌 위험)
- selfdestruct (EIP-6780 이후 의미 없음 + 위험)
- address.transfer() / address.send() (2300 gas 제한 문제)
- 루프 안에서 외부 호출
- 검증 없는 abi.encodePacked (해시 충돌 — abi.encode 사용)
- unchecked 블록 남발 (overflow 의도적인 경우만)
```

## Checks-Effects-Interactions + nonReentrant

```solidity
function withdraw(uint256 amount) external nonReentrant {
    require(balances[msg.sender] >= amount, "Insufficient balance"); // Checks
    balances[msg.sender] -= amount;                                  // Effects
    (bool ok, ) = msg.sender.call{value: amount}("");                // Interactions
    require(ok, "Transfer failed");
    emit Withdrawn(msg.sender, amount);
}
```

외부 호출 있는 함수에 `nonReentrant`(OpenZeppelin ReentrancyGuard) **무조건** 붙일 것.

## Access Control — modifier로만

인라인 `require(msg.sender == owner)` 금지. `onlyOwner` / `validAddress` modifier로 분리. OpenZeppelin `Ownable`/`AccessControl` 쓸 경우 직접 modifier 구현 금지 — 라이브러리 상속만.

## 상태 전환 — 중앙 함수 통과 필수

```solidity
function _assertValidTransition(Status from, Status to) internal pure {
    if (from == Status.Pending  && to == Status.Approved) return;
    if (from == Status.Approved && to == Status.Revoked)  return;
    revert("Invalid status transition");
}
function _setStatus(bytes32 id, Status to) internal {
    Status from = assets[id].status;
    _assertValidTransition(from, to);
    assets[id].status = to;
    emit StatusChanged(id, from, to);
}
```

직접 `assets[id].status = ...` 금지 — 반드시 `_setStatus` 통과.

## 이벤트 — 모든 상태 변경마다 emit

필터링에 쓸 필드(id, address)에 `indexed` (최대 3개). emit 누락 시 오프체인 인덱싱 불가.

## 입력 검증 — 모든 public/external 함수 최상단 require

`require(id != bytes32(0))`, 길이 검증, 중복 등록 검증. 에러 메시지 필수. gas 효율 위해 Custom Error(`error AlreadyRegistered(bytes32 id);`) 권장.

## 크로스체인 수신 (Axelar GMP 등)

`_execute`에서 `sourceChain`/`sourceAddress`를 `keccak256` 비교로 trusted 검증 후에만 처리. recipient zero-address 검증.

## 금액 계산

```solidity
uint256 fee = (amount * FEE_BPS) / BASIS_POINTS; // 곱셈 먼저, BASIS_POINTS=10_000
```

## 컨트랙트 완성 기준

```
□ 모든 public/external 함수에 입력 검증 있음
□ 외부 호출 있는 함수에 nonReentrant 붙어 있음
□ 모든 상태 변경에 event emit 있음
□ msg.sender 검증이 modifier로 분리됨
□ 크로스체인 수신 함수에 sourceChain/sourceAddress 검증 있음
□ 직접 작성한 타입이 없고 공용 타입 파일(AssetTypes.sol)에서 import함
```

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "reactive-lib/interfaces/ISystemContract.sol";
import { Vm } from "forge-std/Vm.sol";

/// @notice Stand-in for the Reactive Omni system contract at 0x8888…8888, etched into the test EVM.
///         It keeps live subscriptions (so the harness only delivers logs a contract is really subscribed
///         to, which exercises the dynamic subscriptions) and queues callback requests for delivery.
///         Bookkeeping is excluded from gas metering: the real system contract only emits an event for
///         `subscribe` and `requestCallback`, so charging the caller for this mock's storage would
///         overstate the reactive contract's gas by ~10x.
contract MockSystem {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @dev Roughly what the real system contract spends emitting its Subscribe / CallbackRequest event.
    uint256 internal constant EVENT_GAS = 6_000;
    uint256 internal constant REACTIVE_IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    struct Sub {
        address subscriber;
        uint256 chainId;
        address contractAddress;
        uint256[4] topics;
        bool active;
    }

    struct Request {
        address sender;
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    Sub[] internal _subs;
    Request[] internal _requests;
    uint256 public delivered;

    function subscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        _burn(EVENT_GAS);
        VM.pauseGasMetering();
        _subs.push(Sub(msg.sender, c, a, [t0, t1, t2, t3], true));
        VM.resumeGasMetering();
    }

    function unsubscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        _burn(EVENT_GAS);
        VM.pauseGasMetering();
        _unsubscribe(c, a, t0, t1, t2, t3);
        VM.resumeGasMetering();
    }

    function _unsubscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) internal {
        for (uint256 i = 0; i < _subs.length; ++i) {
            Sub storage s = _subs[i];
            if (
                s.active && s.subscriber == msg.sender && s.chainId == c && s.contractAddress == a && s.topics[0] == t0
                    && s.topics[1] == t1 && s.topics[2] == t2 && s.topics[3] == t3
            ) {
                s.active = false;
                return; // the real network removes one matching subscription
            }
        }
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory c) external {
        _burn(EVENT_GAS + 16 * c.payload.length);
        VM.pauseGasMetering();
        _requests.push(Request(msg.sender, c.chainId, c.recipient, c.gasLimit, c.payload));
        VM.resumeGasMetering();
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    receive() external payable { }

    function _burn(uint256 g) internal view {
        uint256 target = gasleft() - g;
        while (gasleft() > target) { }
    }

    // ------------------------------------------------------------------ harness helpers

    function matches(address subscriber, uint256 c, address a, uint256[4] memory t) external view returns (bool) {
        for (uint256 i = 0; i < _subs.length; ++i) {
            Sub storage s = _subs[i];
            if (!s.active || s.subscriber != subscriber) continue;
            if (s.chainId != 0 && s.chainId != c) continue;
            if (s.contractAddress != address(0) && s.contractAddress != a) continue;
            bool ok = true;
            for (uint256 k = 0; k < 4; ++k) {
                if (s.topics[k] != REACTIVE_IGNORE && s.topics[k] != t[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function activeSubscriptions(address subscriber) external view returns (uint256 n) {
        for (uint256 i = 0; i < _subs.length; ++i) {
            if (_subs[i].active && _subs[i].subscriber == subscriber) ++n;
        }
    }

    function pending() external view returns (uint256) {
        return _requests.length - delivered;
    }

    function totalRequests() external view returns (uint256) {
        return _requests.length;
    }

    function next() external returns (Request memory r) {
        r = _requests[delivered++];
    }

    function request(uint256 i) external view returns (Request memory) {
        return _requests[i];
    }
}

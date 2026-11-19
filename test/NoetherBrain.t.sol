// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { NoetherBrain } from "../src/reactive/NoetherBrain.sol";
import { NoetherBrainWeights } from "../src/reactive/NoetherBrainWeights.sol";

contract BrainProbe {
    function logit(int256[6] memory x) external pure returns (int256) {
        return NoetherBrain.logit(x);
    }

    function probabilityBps(int256 z) external pure returns (uint256) {
        return NoetherBrain.probabilityBps(z);
    }
}

/// @notice The scorer that runs inside react() is bit-exact with the Python model that trained it.
contract NoetherBrainTest is Test {
    BrainProbe probe = new BrainProbe();

    function test_GoldenVectorsMatchPython() public view {
        string memory card = vm.readFile("model/model_card.json");
        int256[] memory expected = vm.parseJsonIntArray(card, ".golden.logit");
        assertEq(expected.length, 16);
        for (uint256 r = 0; r < expected.length; ++r) {
            int256[] memory row = vm.parseJsonIntArray(card, string.concat(".golden.x[", vm.toString(r), "]"));
            int256[6] memory x;
            for (uint256 i = 0; i < 6; ++i) {
                x[i] = row[i];
            }
            assertEq(probe.logit(x), expected[r], string.concat("golden row ", vm.toString(r)));
        }
    }

    function test_ObviousForgeryEscalates() public view {
        int256[6] memory x = [int256(1e6), 1e6, 1e6, 1e6, 5e5, 1e6];
        assertGe(probe.logit(x), NoetherBrainWeights.ESCALATE_LOGIT);
    }

    function test_TypicalHonestDelayDoesNotEscalate() public view {
        int256[6] memory x = [int256(1e5), 2e4, 0, 25e4, 0, 1e4];
        assertLt(probe.logit(x), NoetherBrainWeights.ESCALATE_LOGIT);
    }

    function test_ProbabilityIsMonotone() public view {
        uint256 prev = 0;
        for (int256 z = -7e6; z <= 7e6; z += 25e4) {
            uint256 p = probe.probabilityBps(z);
            assertGe(p, prev);
            assertLe(p, 10_000);
            prev = p;
        }
    }

    function testFuzz_LogitNeverReverts(uint32[6] memory raw) public view {
        int256[6] memory x;
        for (uint256 i = 0; i < 6; ++i) {
            x[i] = int256(uint256(raw[i]) % 1_000_001);
        }
        probe.logit(x);
    }

    function test_GasBudgetFitsInsideReact() public {
        int256[6] memory x = [int256(1e6), 1e6, 1e6, 1e6, 5e5, 1e6];
        uint256 g = gasleft();
        probe.logit(x);
        uint256 used = g - gasleft();
        emit log_named_uint("scorer gas", used);
        assertLt(used, 120_000, "reactive transactions are capped at 900k gas");
    }
}

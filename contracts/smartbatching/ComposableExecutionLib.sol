// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./IComposableExecution.sol";
import "./SmartBatchStorage.sol";

/**
 * @title ComposableExecutionLib — ERC-8211 Execution Engine
 * @notice Shared library implementing the normative 3-step composable
 *         execution algorithm: resolve inputs → execute call → capture outputs.
 */
library ComposableExecutionLib {
    // ── Errors ───────────────────────────────────────────

    error ConstraintFailed(uint256 entryIndex, uint256 paramIndex, uint256 constraintIndex);
    error StaticCallFailed(address target, bytes data);
    error BalanceFetchFailed(address token, address account);
    error DuplicateTarget(uint256 entryIndex);
    error DuplicateValue(uint256 entryIndex);
    error BalanceAsTarget(uint256 entryIndex);
    error CallFailed(address target, bytes returnData);
    error InvalidBalanceParamLength(uint256 got);

    // ── Events ───────────────────────────────────────────

    event EntryExecuted(uint256 indexed entryIndex, address target, uint256 value);
    event PredicateChecked(uint256 indexed entryIndex);

    // ── Main execution ───────────────────────────────────

    /**
     * @notice Execute a full composable batch.
     * @param executions  Ordered array of ComposableExecution entries.
     * @param storageAddr Address of the SmartBatchStorage contract.
     * @param account     Account address for Storage namespace derivation.
     */
    function execute(
        ComposableExecution[] calldata executions,
        address storageAddr,
        address account
    ) internal {
        for (uint256 i = 0; i < executions.length; i++) {
            _executeEntry(executions[i], i, storageAddr, account);
        }
    }

    // ── Per-entry execution ──────────────────────────────

    function _executeEntry(
        ComposableExecution calldata entry,
        uint256 entryIndex,
        address storageAddr,
        address account
    ) private {
        // Step 1: Process input parameters — resolve and route each value
        address target = address(0);
        uint256 value = 0;
        bytes memory callData = abi.encodePacked(entry.functionSig);
        bool hasTarget = false;
        bool hasValue = false;

        for (uint256 p = 0; p < entry.inputParams.length; p++) {
            InputParam calldata param = entry.inputParams[p];

            // Step 1a: Resolve the value via the fetcher
            bytes memory resolvedValue = _resolve(param);

            // Step 1b: Validate constraints
            _validateConstraints(param.constraints, resolvedValue, entryIndex, p);

            // Step 1c: Route to destination
            if (param.paramType == InputParamType.TARGET) {
                if (hasTarget) revert DuplicateTarget(entryIndex);
                if (param.fetcherType == InputParamFetcherType.BALANCE) revert BalanceAsTarget(entryIndex);
                hasTarget = true;
                target = address(uint160(uint256(bytes32(resolvedValue))));
            } else if (param.paramType == InputParamType.VALUE) {
                if (hasValue) revert DuplicateValue(entryIndex);
                hasValue = true;
                value = uint256(bytes32(resolvedValue));
            } else {
                // CALL_DATA — append to calldata
                callData = abi.encodePacked(callData, resolvedValue);
            }
        }

        // Step 2: Execute the call (skip if target == address(0) → predicate entry)
        bytes memory returnData;
        if (target != address(0)) {
            bool success;
            (success, returnData) = target.call{value: value}(callData);
            if (!success) revert CallFailed(target, returnData);
            emit EntryExecuted(entryIndex, target, value);
        } else {
            returnData = "";
            emit PredicateChecked(entryIndex);
        }

        // Step 3: Process output parameters — capture to Storage
        _processOutputs(entry.outputParams, returnData, storageAddr, account);
    }

    // ── Value resolution ─────────────────────────────────

    function _resolve(InputParam calldata param) private view returns (bytes memory) {
        if (param.fetcherType == InputParamFetcherType.RAW_BYTES) {
            return param.paramData;
        }

        if (param.fetcherType == InputParamFetcherType.STATIC_CALL) {
            (address contractAddr, bytes memory staticCallData) =
                abi.decode(param.paramData, (address, bytes));
            (bool ok, bytes memory result) = contractAddr.staticcall(staticCallData);
            if (!ok) revert StaticCallFailed(contractAddr, staticCallData);
            return result;
        }

        if (param.fetcherType == InputParamFetcherType.BALANCE) {
            if (param.paramData.length != 40) revert InvalidBalanceParamLength(param.paramData.length);
            address token;
            address account;
            // abi.encodePacked(address, address) → exactly 40 bytes
            assembly {
                // paramData starts at offset 32 (skip length prefix)
                let ptr := add(mload(add(param, 0x40)), 0x20) // paramData bytes pointer
                token := shr(96, mload(ptr))
                account := shr(96, mload(add(ptr, 20)))
            }

            if (token == address(0)) {
                return abi.encode(account.balance);
            } else {
                (bool ok, bytes memory result) = token.staticcall(
                    abi.encodeWithSignature("balanceOf(address)", account)
                );
                if (!ok) revert BalanceFetchFailed(token, account);
                return result;
            }
        }

        // Should never reach here
        return param.paramData;
    }

    // ── Constraint validation ────────────────────────────

    function _validateConstraints(
        Constraint[] calldata constraints,
        bytes memory resolvedValue,
        uint256 entryIndex,
        uint256 paramIndex
    ) private pure {
        if (constraints.length == 0) return;
        bytes32 val = bytes32(resolvedValue);

        for (uint256 c = 0; c < constraints.length; c++) {
            Constraint calldata con = constraints[c];

            if (con.constraintType == ConstraintType.EQ) {
                bytes32 ref = abi.decode(con.referenceData, (bytes32));
                if (val != ref) revert ConstraintFailed(entryIndex, paramIndex, c);
            } else if (con.constraintType == ConstraintType.GTE) {
                bytes32 ref = abi.decode(con.referenceData, (bytes32));
                if (uint256(val) < uint256(ref)) revert ConstraintFailed(entryIndex, paramIndex, c);
            } else if (con.constraintType == ConstraintType.LTE) {
                bytes32 ref = abi.decode(con.referenceData, (bytes32));
                if (uint256(val) > uint256(ref)) revert ConstraintFailed(entryIndex, paramIndex, c);
            } else if (con.constraintType == ConstraintType.IN) {
                (bytes32 lower, bytes32 upper) = abi.decode(con.referenceData, (bytes32, bytes32));
                if (uint256(val) < uint256(lower) || uint256(val) > uint256(upper)) {
                    revert ConstraintFailed(entryIndex, paramIndex, c);
                }
            }
        }
    }

    // ── Output capture ───────────────────────────────────

    function _processOutputs(
        OutputParam[] calldata outputs,
        bytes memory returnData,
        address /* storageAddr */,
        address account
    ) private {
        for (uint256 o = 0; o < outputs.length; o++) {
            OutputParam calldata out = outputs[o];

            if (out.fetcherType == OutputParamFetcherType.EXEC_RESULT) {
                (uint256 returnValueCount, address storageContract, bytes32 storageSlot) =
                    abi.decode(out.paramData, (uint256, address, bytes32));
                _writeWords(returnData, returnValueCount, storageContract, storageSlot, account);
            } else {
                // STATIC_CALL output
                (
                    uint256 returnValueCount,
                    address sourceContract,
                    bytes memory sourceCallData,
                    address storageContract,
                    bytes32 storageSlot
                ) = abi.decode(out.paramData, (uint256, address, bytes, address, bytes32));

                (bool ok, bytes memory result) = sourceContract.staticcall(sourceCallData);
                if (!ok) revert StaticCallFailed(sourceContract, sourceCallData);
                _writeWords(result, returnValueCount, storageContract, storageSlot, account);
            }
        }
    }

    function _writeWords(
        bytes memory data,
        uint256 wordCount,
        address storageContract,
        bytes32 baseSlot,
        address account
    ) private {
        SmartBatchStorage store = SmartBatchStorage(storageContract);
        for (uint256 i = 0; i < wordCount; i++) {
            bytes32 derivedSlot = keccak256(abi.encodePacked(baseSlot, i));
            bytes32 word;
            uint256 offset = 32 + (i * 32); // skip length prefix
            assembly {
                word := mload(add(data, offset))
            }
            store.writeStorage(derivedSlot, word, account);
        }
    }
}

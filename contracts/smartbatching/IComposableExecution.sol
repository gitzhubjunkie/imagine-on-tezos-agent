// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ERC-8211: Smart Batching — Data Types & Interface
 * @notice Composable batch encoding where each parameter declares how to obtain
 *         its value at execution time (literal, staticcall, or balance query)
 *         and what constraints that value must satisfy.
 */

// ── Enums ────────────────────────────────────────────────

/// @notice Where a resolved input value is routed.
enum InputParamType {
    TARGET,    // resolved value → call target address
    VALUE,     // resolved value → ETH value to forward
    CALL_DATA  // resolved value → appended to calldata
}

/// @notice How an input value is obtained at execution time.
enum InputParamFetcherType {
    RAW_BYTES,    // literal value — paramData used as-is
    STATIC_CALL,  // resolve via an arbitrary staticcall
    BALANCE       // query ERC-20 or native balance
}

/// @notice Source of captured output data.
enum OutputParamFetcherType {
    EXEC_RESULT,  // capture from the return data of the just-executed call
    STATIC_CALL   // capture from a separate staticcall (post-execution state read)
}

/// @notice Constraint comparison type.
enum ConstraintType {
    EQ,   // value == referenceData
    GTE,  // value >= referenceData
    LTE,  // value <= referenceData
    IN    // lowerBound <= value <= upperBound
}

// ── Structs ──────────────────────────────────────────────

/// @notice An inline predicate on a resolved value.
struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;
}

/// @notice A single input parameter with resolution strategy and routing.
struct InputParam {
    InputParamType paramType;
    InputParamFetcherType fetcherType;
    bytes paramData;
    Constraint[] constraints;
}

/// @notice A return-value capture instruction.
struct OutputParam {
    OutputParamFetcherType fetcherType;
    bytes paramData;
}

/// @notice One step in a composable batch.
struct ComposableExecution {
    bytes4 functionSig;
    InputParam[] inputParams;
    OutputParam[] outputParams;
}

// ── Interface ────────────────────────────────────────────

interface IComposableExecution {
    /// @notice Executes a composable batch following the ERC-8211 algorithm.
    /// @param executions Ordered array of composable execution entries.
    function executeComposable(ComposableExecution[] calldata executions) external payable;
}

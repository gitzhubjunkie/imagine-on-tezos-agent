// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title SmartBatchStorage — ERC-8211 Storage Contract
 * @notice Namespaced key-value store for passing return values between
 *         composable batch steps. Each (account, caller) pair gets an
 *         isolated namespace. Slots must be written before they can be read.
 */
contract SmartBatchStorage {
    // namespace → namespacedSlot → value
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _store;
    // namespace → namespacedSlot → initialized flag
    mapping(bytes32 => mapping(bytes32 => bool)) private _initialized;

    error SlotNotInitialized(bytes32 namespace, bytes32 slot);

    /// @notice Write a value to a namespaced slot.
    ///         Namespace = keccak256(account, msg.sender).
    /// @param slot   Logical slot key.
    /// @param value  32-byte value to store.
    /// @param account The account address that owns this namespace.
    function writeStorage(bytes32 slot, bytes32 value, address account) external {
        bytes32 ns = getNamespace(account, msg.sender);
        bytes32 nsSlot = getNamespacedSlot(ns, slot);
        _store[ns][nsSlot] = value;
        _initialized[ns][nsSlot] = true;
    }

    /// @notice Read a value from a namespaced slot.
    /// @param namespace Pre-computed namespace.
    /// @param slot      Logical slot key.
    function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32) {
        bytes32 nsSlot = getNamespacedSlot(namespace, slot);
        if (!_initialized[namespace][nsSlot]) {
            revert SlotNotInitialized(namespace, slot);
        }
        return _store[namespace][nsSlot];
    }

    /// @notice Check whether a slot has been written in the given namespace.
    function isSlotInitialized(bytes32 namespace, bytes32 slot) external view returns (bool) {
        bytes32 nsSlot = getNamespacedSlot(namespace, slot);
        return _initialized[namespace][nsSlot];
    }

    /// @notice Derive a namespace from (account, caller).
    function getNamespace(address account, address caller) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(account, caller));
    }

    /// @notice Derive a namespaced slot from (namespace, slot).
    function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(namespace, slot));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SimpleStorage
 * @dev Store and retrieve a value
 */
contract SimpleStorage {
    uint256 private storedData;
    
    event ValueChanged(uint256 indexed newValue, address indexed changer);
    
    /**
     * @dev Store a value
     * @param _value The value to store
     */
    function set(uint256 _value) public {
        storedData = _value;
        emit ValueChanged(_value, msg.sender);
    }
    
    /**
     * @dev Retrieve the stored value
     * @return The stored value
     */
    function get() public view returns (uint256) {
        return storedData;
    }
    
    /**
     * @dev Increment the stored value by 1
     */
    function increment() public {
        storedData += 1;
        emit ValueChanged(storedData, msg.sender);
    }
} 
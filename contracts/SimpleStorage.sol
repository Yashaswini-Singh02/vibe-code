// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SimpleStorage
 * @dev Store & retrieve value in a variable
 */
contract SimpleStorage {
    uint256 private storedData;
    
    event ValueChanged(uint256 newValue, address changedBy);
    
    /**
     * @dev Store value in variable
     * @param x value to store
     */
    function set(uint256 x) public {
        storedData = x;
        emit ValueChanged(x, msg.sender);
    }
    
    /**
     * @dev Return value 
     * @return value of 'storedData'
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
    
    /**
     * @dev Reset the stored value to 0
     */
    function reset() public {
        storedData = 0;
        emit ValueChanged(0, msg.sender);
    }
} 
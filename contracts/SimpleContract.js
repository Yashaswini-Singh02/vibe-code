/**
 * Simple JavaScript Smart Contract Example
 * This demonstrates basic contract functionality in JavaScript
 */

class SimpleContract {
  constructor() {
    this.storage = new Map();
    this.owner = 'contract_creator';
    this.events = [];
  }

  /**
   * Store a value in the contract
   * @param {string} key - The key to store
   * @param {any} value - The value to store
   */
  store(key, value) {
    this.storage.set(key, value);
    this.emitEvent('ValueStored', { key, value, timestamp: Date.now() });
    return true;
  }

  /**
   * Retrieve a value from the contract
   * @param {string} key - The key to retrieve
   * @returns {any} The stored value
   */
  retrieve(key) {
    return this.storage.get(key);
  }

  /**
   * Get all stored keys
   * @returns {Array} Array of all keys
   */
  getAllKeys() {
    return Array.from(this.storage.keys());
  }

  /**
   * Check if contract has a specific key
   * @param {string} key - The key to check
   * @returns {boolean} True if key exists
   */
  hasKey(key) {
    return this.storage.has(key);
  }

  /**
   * Delete a key from storage
   * @param {string} key - The key to delete
   */
  deleteKey(key) {
    if (this.storage.has(key)) {
      this.storage.delete(key);
      this.emitEvent('ValueDeleted', { key, timestamp: Date.now() });
      return true;
    }
    return false;
  }

  /**
   * Get the contract owner
   * @returns {string} The owner address
   */
  getOwner() {
    return this.owner;
  }

  /**
   * Emit an event (simple event system)
   * @param {string} eventName - Name of the event
   * @param {object} data - Event data
   */
  emitEvent(eventName, data) {
    this.events.push({
      event: eventName,
      data: data,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all events
   * @returns {Array} Array of all events
   */
  getEvents() {
    return this.events;
  }

  /**
   * Get events by name
   * @param {string} eventName - Name of the event to filter by
   * @returns {Array} Array of filtered events
   */
  getEventsByName(eventName) {
    return this.events.filter((event) => event.event === eventName);
  }

  /**
   * Clear all storage
   */
  clearStorage() {
    this.storage.clear();
    this.emitEvent('StorageCleared', { timestamp: Date.now() });
  }

  /**
   * Get storage size
   * @returns {number} Number of items in storage
   */
  getStorageSize() {
    return this.storage.size;
  }
}

// Export the contract class
module.exports = SimpleContract;

// Example usage:
if (require.main === module) {
  const contract = new SimpleContract();

  // Test the contract
  contract.store('greeting', 'Hello World');
  contract.store('number', 42);
  contract.store('array', [1, 2, 3, 4, 5]);

  console.log('Greeting:', contract.retrieve('greeting'));
  console.log('Number:', contract.retrieve('number'));
  console.log('All keys:', contract.getAllKeys());
  console.log('Storage size:', contract.getStorageSize());
  console.log('Events:', contract.getEvents());
}

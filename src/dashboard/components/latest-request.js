/** Keep only the newest request for the still-selected key eligible to commit UI state. */
export function createLatestRequestGate(getCurrentKey) {
  let generation = 0

  function begin(key) {
    generation += 1
    return { generation, key }
  }

  function isCurrent(ticket) {
    return ticket.generation === generation && getCurrentKey() === ticket.key
  }

  return { begin, isCurrent }
}

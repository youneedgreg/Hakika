// A state machine is a table: for each state, the events it accepts and the state each one leads to.
// Code moves a record only through transition(), so an impossible change (a declined request
// becoming paid, a held milestone paying out) throws instead of reaching the database.

export type Machine<S extends string, E extends string> = Record<S, Partial<Record<E, S>>>;

export class InvalidTransition extends Error {
  constructor(readonly machine: string, readonly from: string, readonly event: string) {
    super(`${machine}: "${event}" is not allowed from "${from}".`);
    this.name = "InvalidTransition";
  }
}

export function defineMachine<S extends string, E extends string>(name: string, table: Machine<S, E>) {
  return {
    name,
    table,
    can(from: S, event: E): boolean {
      return table[from][event] !== undefined;
    },
    transition(from: S, event: E): S {
      const to = table[from][event];
      if (to === undefined) throw new InvalidTransition(name, from, event);
      return to;
    },
    // The events a state accepts, for UIs and for tests.
    events(from: S): E[] {
      return Object.keys(table[from]) as E[];
    },
  };
}

/**
 * A map of maps with a convenient {@see add} method that creates the inner map if it does not exist
 */
export class MapMap<K1, K2, V> extends Map<K1, Map<K2, V>> {
    add(outerKey: K1, innerKey: K2, value: V) {
        const existingMap = this.get(outerKey);
        if (existingMap !== undefined) {
            existingMap.set(innerKey, value);
        } else {
            this.set(outerKey, new Map().set(innerKey, value));
        }
    }
}

/**
 * A map of sets. Otherwise the same as {@see MapMap}.
 */
export class MapSet<K1, K2> extends Map<K1, Set<K2>> {
    add(outerKey: K1, innerKey: K2) {
        const existingSet = this.get(outerKey);
        if (existingSet !== undefined) {
            existingSet.add(innerKey);
        } else {
            this.set(outerKey, new Set<K2>().add(innerKey));
        }
    }
}

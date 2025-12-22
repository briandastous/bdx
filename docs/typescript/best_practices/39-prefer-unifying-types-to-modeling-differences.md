# 39. Prefer Unifying Types to Modeling Differences

## Guidance

- Avoid proliferating near-identical variants of the same concept (it creates conversion code and cognitive overhead).
- Prefer choosing a single internal representation and converting at boundaries (DB ↔ app, API ↔ app).
- Don’t unify types that represent different real-world concepts; unify only “the same thing with different shapes.”

## Examples

```ts
type Student = {
  firstName: string;
  lastName: string;
  birthDate: string; // ISO date
};

type StudentRow = {
  first_name: string;
  last_name: string;
  birth_date: string;
};

function fromRow(row: StudentRow): Student {
  return { firstName: row.first_name, lastName: row.last_name, birthDate: row.birth_date };
}
```


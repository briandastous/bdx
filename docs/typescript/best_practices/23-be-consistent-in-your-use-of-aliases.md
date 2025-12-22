# 23. Be Consistent in Your Use of Aliases

## Guidance

- Narrowing applies to the *specific variable/expression* TypeScript can track.
- If you alias a property (`const { p } = obj`), use the alias consistently inside the narrowed block; TypeScript can’t assume `obj.p` is unchanged.
- Prefer immutable inputs (`readonly` props) when you want narrowing to “stick” across helpers/callbacks.

## Examples

```ts
type Person = { name: string | null };

function greet(person: Person) {
  const { name } = person;
  if (name) {
    name.toUpperCase(); // OK: name is string here

    // person.name.toUpperCase(); // often still errors: person.name may have changed
  }
}
```


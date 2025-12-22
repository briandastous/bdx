# 41. Name Types Using the Language of Your Problem Domain

## Guidance

- Prefer domain terms over generic “shape” names: `ConservationStatus`, `CurrencyCode`, `GeoPosition` beat `Info`, `Data`, `Entity`.
- Use names consistently; if two things differ, the names should communicate the distinction.
- Let naming drive modeling: if you can’t name it, you may not understand the concept well enough to type it well.

## Examples

```ts
type CurrencyCode = "USD" | "CAD" | "EUR";
type Money = { amountCents: number; currency: CurrencyCode };

type OrderId = string & { readonly __brand: "OrderId" };
type CustomerId = string & { readonly __brand: "CustomerId" };

type Order = { id: OrderId; customerId: CustomerId; total: Money };
```


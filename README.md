# Ours

A small, private notebook for a two-person household. Static front end (HTML/CSS/vanilla JS, no build step).

- No data lives in this repository. Balances, activity and saved items are fetched at open time from a
  database that only answers to a key carried in the private link's `#fragment` (fragments are never sent to this host).
- `js/config.js` holds a publishable API key, which is public by design and can only call the key-checked functions.

# SaveMyTokens

**Decide which Claude Code session gets your Claude allowance.**

```
npx savemytokens
```

```
  5h █████░░░░░░░  42% resets 18:30    7d ██░░░░░░░░░░  18% resets Sun

     session    target  used share priority progress     last prompt

  ACTIVE 3 · a Claude session is open — these hold a share
  • webinvoke     50%   21%   51% HIGH     [||||......] Implement the provider fallback chain e…
  • buydiff       30%   13%   32% NORMAL   [||||......] Fix the verdict table alignment on mobi…
  • scratch       20%    7%   18% LOW      [||||......] Try the alternate parser and compare

  RECENT 1 · worked on today, nothing running
  · reposhine      0%    0%    0% 3h ago   [..........] This is the new plan for reposhine

  PARKED 1
  · obp-ui         0%    0%    0% 6d ago   [..........] yes, that is it. commit push

  3 sessions are sharing this window.
```

## What you get

- **The real numbers.** Your 5-hour and weekly usage exactly as Anthropic publishes them — never an
  invented "% remaining".
- **A split you control.** Give each session a target share and a priority. Spare capacity goes to
  the highest priority first.
- **Claude working to its budget.** As a session eats into its share it is told to narrow scope and
  finish, and to write down what it dropped — which comes back next time you work on that project.
- **Unused share returned.** When a session finishes, whatever it did not spend goes to the others.
- **Your window in the status line.** `SMT · webinvoke target 50% · used 21% · HIGH · 5h 42% 18:30`

## Commands

```
npx savemytokens                        the control centre
npx savemytokens share buydiff 40       pin a target share
npx savemytokens priority buydiff high  who gets spare capacity first
npx savemytokens policy strict          wind down earlier when it gets tight
npx savemytokens hud                    pick a status line, previewed on your numbers
npx savemytokens audit                  what your last 7 days wasted
npx savemytokens uninstall              remove every trace
```

Requires Node 18.17+. Everything is local: no daemon, no account, and no network call in this tool.

MIT.

<div align="center">

# SaveMyTokens

### Decide which Claude Code session gets your Claude allowance.

<code>npx savemytokens</code>

<img src="https://img.shields.io/badge/dependencies-0-1a7f37?style=flat-square" alt="zero dependencies">
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018.17-2b7489?style=flat-square" alt="node 18.17+">
<img src="https://img.shields.io/badge/local%20only-no%20network%20call-6e40c9?style=flat-square" alt="local only">
<img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT">

</div>

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

<br>

|  |  |
| :-- | :-- |
| **The real numbers** | Your 5-hour and weekly usage exactly as Anthropic publishes them — never an invented *"% remaining"*. |
| **A split you control** | Give each session a target share and a priority. Spare capacity goes to the highest priority first. |
| **Claude working to it** | As a session eats into its share it is told to narrow scope and finish, and to write down what it dropped — which comes back next time you work on that project. |
| **Unused share returned** | When a session finishes, whatever it did not spend goes to the others. |
| **In your status line** | `SMT · webinvoke target 50% · used 21% · HIGH · 5h 42% 18:30` |

<br>

| command | |
| :-- | :-- |
| `npx savemytokens` | the control centre |
| `npx savemytokens share buydiff 40` | pin a target share |
| `npx savemytokens priority buydiff high` | who gets spare capacity first |
| `npx savemytokens policy strict` | wind down earlier when it gets tight |
| `npx savemytokens hud` | pick a status line, previewed on your numbers |
| `npx savemytokens audit` | what your last 7 days wasted |
| `npx savemytokens uninstall` | remove every trace |

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine</sub>
</div>

# Lakdi (Realtime Card Game)

Minimal Node + Socket.IO implementation of **Lakdi** with strict rules:
- Two discard piles: **Immediate** (current player’s fresh discards) and **Past** (previous player’s discard available to next player).
- Turn paths: **Normal (Discard 1–3 same rank → Draw from Stock/Past → Immediate ⇒ Past)** or **Lakdi (declare) in lieu of discard+draw**.
- **First valid cut** only. **Timer rule** with auto-discard highest card if time expires.
- Scoring: A=1, 2–10=face, J=11, Q=12, K=13; optional +50 invalid Lakdi penalty.

## Project Layout
Lakdi/
├── client/
│ ├── index.html
│ ├── style.css
│ └── script.js
├── server/
│ ├── server.js
│ ├── gameLogic.js
│ ├── botLogic.js
│ └── package.json
├── README.md
└── .gitignore

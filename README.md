# ♟ Chess Openings Trainer

A build-time pipeline that constructs a filtered opening DAG from the [Lichess open database](https://database.lichess.org/), enriches every position with AI-generated explanations, and produces structured puzzles — all stored in PostgreSQL, ready to power a future study application.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Pipeline Stages](#pipeline-stages)
6. [Database Schema](#database-schema)
7. [Getting Started](#getting-started)
8. [Environment Variables](#environment-variables)
9. [Scripts](#scripts)
10. [Roadmap](#roadmap)
11. [License](#license)

---

## What This Does

### Opening DAG Construction
- Parses millions of Lichess games filtered by rating band (default 1000–1600 ELO) and time control.
- Builds a Directed Acyclic Graph (DAG) of chess positions where only moves played in ≥10% of games are kept — limiting the branching factor to 2–4 per node.
- Detects transpositions (same position reached via different move orders) and links them.
- Tags **anti-moves** — moves where Stockfish shows an evaluation drop >50 centipawns, explicitly taught as moves to avoid.
- Maps positions to ECO opening names.

### AI-Generated Lessons
- For every edge in the DAG, sends the position context (FEN, statistics, engine evaluation, sibling moves) to Claude API.
- Generates structured reasoning: *why play this move*, *what the opponent wants*, *the game plan*, and *key ideas*.
- Stored per-edge with model and prompt versioning for future regeneration.

### Puzzle Generation
- Creates 4–8 puzzle types per node across 5 difficulty tiers.
- Types: best move, why this move, why not (anti-move), game plan, consequence, predict opponent, trap recognition, transposition awareness.
- Distractors generated via LLM with heuristic fallback.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BUILD-TIME PIPELINE                   │
│                                                         │
│  Lichess PGN → PGN Parser → Aggregator → DAG Filter    │
│                                 ↓                       │
│                    Transposition Detector                │
│                                 ↓                       │
│                    Stockfish Anti-move Tagger            │
│                                 ↓                       │
│                    ECO Mapper                            │
│                                 ↓                       │
│                    Study Plan Generator (Claude API)     │
│                                 ↓                       │
│                    Puzzle Generator                      │
│                                 ↓                       │
│                    PostgreSQL Database                   │
│                                                         │
│  Pipeline Orchestrator (checkpointing + progress)       │
└─────────────────────────────────────────────────────────┘
```

All computation happens at build time. The populated database is the deliverable — ready for a future runtime application (API + frontend + SRS engine).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Pipeline Language** | Python 3.11+ | All pipeline scripts |
| **Chess Library** | [python-chess](https://python-chess.readthedocs.io/) | PGN parsing, FEN normalization, board state |
| **Engine** | [Stockfish 16](https://stockfishchess.org/) + `stockfish` wrapper | Position evaluation, anti-move detection |
| **AI Explanations** | [Anthropic Claude API](https://docs.anthropic.com/) | Generate move reasoning |
| **Database** | [PostgreSQL 16](https://www.postgresql.org/) | DAG storage, graph queries via recursive CTEs |
| **Logging** | [structlog](https://www.structlog.org/) | Structured JSON pipeline logging |
| **Retry Logic** | [tenacity](https://tenacity.readthedocs.io/) | LLM API retry with exponential backoff |

---

## Project Structure

```
learn-chess-openings/
├── docs/
│   └── design_document_v2.md      # Full design document
├── pipeline/
│   ├── pgn_parser.py              # PGN filtering + streaming move extraction
│   ├── aggregator.py              # Memory-bounded position aggregation
│   ├── engine_tagger.py           # Stockfish anti-move detection (parallel)
│   ├── eco_mapper.py              # ECO code → position mapping
│   ├── study_plan_generator.py    # LLM reasoning generation with checkpointing
│   ├── puzzle_generator.py        # Puzzle creation from stored data
│   └── orchestrator.py            # Pipeline stages runner
├── db/
│   ├── schema.sql                 # Full PostgreSQL schema
│   └── migrations/                # Schema migrations
├── scripts/
│   ├── run_pipeline.py            # CLI entry point for pipeline
│   └── verify_dag.py              # DAG validation checks
├── lichess/
│   ├── load_dataset.py            # Lichess dataset loader
│   └── eval_db.py                 # Evaluation database utilities
├── tests/
│   ├── test_pgn_parser.py
│   ├── test_aggregator.py
│   ├── test_engine_tagger.py
│   └── test_puzzle_generator.py
├── .env.example                   # Required environment variables
├── .gitignore
├── requirements.txt               # Python dependencies
├── docker-compose.yml             # PostgreSQL setup
└── README.md
```

---

## Pipeline Stages

The pipeline runs sequentially. Each stage is idempotent and checkpointed — it can be re-run after failure without duplicating work.

### Stage 1 — PGN Parse & Aggregate
```
Lichess PGN file (filtered by rating band + time control)
    ↓
Stream every game, extract (parent_FEN, child_FEN, move, result) tuples
    ↓
Aggregate move frequencies with bounded memory (flushes to DB at 100k positions)
    ↓
Apply 10% threshold filter → build edges table
```

### Stage 2 — Transposition Detection
```
Identify positions reachable via multiple move orders
    ↓
Store top-5 canonical paths per transposed position
```

### Stage 3 — Stockfish Analysis
```
Evaluate every edge position (parent + child FEN) via Stockfish at depth 18
    ↓
Parallel worker pool (configurable concurrency)
    ↓
Flag anti-moves where eval drop > 50 centipawns
    ↓
Checkpoint after each batch
```

### Stage 4 — ECO Mapping
```
Match FEN positions against ECO code database
    ↓
Assign opening names (e.g. "Sicilian Najdorf", "B90")
```

### Stage 5 — LLM Reasoning
```
For each edge: build context (FEN, stats, eval, siblings)
    ↓
Send to Claude API with structured prompt
    ↓
Parse + validate JSON response
    ↓
Store: why_play, why_not, what_opponent_wants, game_plan, key_ideas
    ↓
Retry with exponential backoff on failures
    ↓
Checkpoint per edge in pipeline_progress table
```

### Stage 6 — Puzzle Generation
```
For each node: derive puzzles from stored edges + reasoning
    ↓
8 puzzle types across 5 difficulty tiers
    ↓
Generate distractors (LLM with heuristic fallback)
    ↓
Store in puzzles table (minimum 4 per node)
```

---

## Database Schema

See the full schema in the [design document](docs/design_document_v2.md#41-database-schema). Key tables:

| Table | Purpose |
|---|---|
| `nodes` | Every unique chess position (FEN, opening name, stats) |
| `edges` | Directed moves between positions (frequency, eval, anti-move flag) |
| `transpositions` | Positions reachable via multiple paths |
| `node_reasoning` | LLM-generated explanations per edge |
| `eco_codes` | Opening name reference |
| `puzzles` | Generated puzzle definitions per node |
| `pipeline_progress` | Checkpointing for resumable pipeline |

---

## Getting Started

### Prerequisites

- Python 3.11+
- PostgreSQL 16
- Stockfish 16 (installed and accessible)
- An Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/learn-chess-openings.git
cd learn-chess-openings

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp .env.example .env
# Edit .env with your database credentials and API keys

# Start PostgreSQL (via Docker)
docker compose up -d

# Initialize database schema
psql -h localhost -U chess -d chess_openings -f db/schema.sql
```

### Running the Pipeline

```bash
# Download a Lichess PGN file first (see https://database.lichess.org/)

# Run the full pipeline
python scripts/run_pipeline.py --pgn data/lichess_db.pgn

# Or run individual stages
python scripts/run_pipeline.py --pgn data/lichess_db.pgn --stage pgn_parse
python scripts/run_pipeline.py --stage stockfish
python scripts/run_pipeline.py --stage llm_reasoning
python scripts/run_pipeline.py --stage puzzles

# Verify the DAG after building
python scripts/verify_dag.py
```

---

## Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```env
# PostgreSQL
DATABASE_URL=postgresql://chess:password@localhost:5432/chess_openings

# Stockfish
STOCKFISH_PATH=/usr/local/bin/stockfish

# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Pipeline config (optional)
MIN_RATING=1000
MAX_RATING=1600
MOVE_THRESHOLD=0.10
STOCKFISH_DEPTH=18
STOCKFISH_WORKERS=4
MAX_MOVE_DEPTH=25
```

---

## Scripts

| Command | Description |
|---|---|
| `python scripts/run_pipeline.py --pgn <file>` | Run full pipeline on a PGN file |
| `python scripts/run_pipeline.py --stage <name>` | Run a single pipeline stage |
| `python scripts/verify_dag.py` | Validate DAG integrity |

---

## Roadmap

- [x] Project architecture & design document
- [ ] **Phase 1 — DAG Builder**
  - [ ] PostgreSQL schema setup
  - [ ] PGN parser with rating/time control filtering
  - [ ] Streaming aggregator with bounded memory
  - [ ] Transposition detection
  - [ ] Stockfish anti-move tagging (parallel)
  - [ ] ECO code mapping
  - [ ] DAG verification script
- [ ] **Phase 2 — Lesson Generation**
  - [ ] LLM prompt pipeline with position context
  - [ ] Retry + JSON validation + checkpointing
  - [ ] Prompt versioning
  - [ ] Depth-first processing with cost tracking
- [ ] **Phase 3 — Puzzle Generation**
  - [ ] All 8 puzzle type generators
  - [ ] Distractor generation (LLM + heuristic fallback)
  - [ ] Difficulty tier assignment
  - [ ] Puzzle validation script

**Future phases (designed, not yet in scope):**
- [ ] SRS engine with ripple propagation
- [ ] FastAPI REST API
- [ ] React frontend (DAG explorer, lessons, puzzles, dashboard)
- [ ] Periodic update pipeline

---

## License

MIT

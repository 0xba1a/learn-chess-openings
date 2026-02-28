# ♟ Chess Openings Trainer

A web application that helps users master chess openings through interactive lessons and spaced-repetition puzzles. Lessons are generated from the [Lichess open database](https://database.lichess.org/) and enriched with AI-powered explanations. Progress is tracked over time, surfacing strengths, weaknesses, and improvement trends in a personal dashboard.

---

## Table of Contents

1. [Features](#features)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Data Pipeline](#data-pipeline)
6. [Core Modules](#core-modules)
7. [Database Schema](#database-schema)
8. [API Design](#api-design)
9. [Getting Started](#getting-started)
10. [Environment Variables](#environment-variables)
11. [Scripts](#scripts)
12. [Roadmap](#roadmap)
13. [License](#license)

---

## Features

### Interactive Lessons
- Curated opening lines parsed from the Lichess master/rated game database.
- AI-generated explanations (via Claude API) for every candidate move — why it's chosen, what alternatives exist, and what plans each side pursues.
- Audio narration of move explanations using the Web Speech Synthesis API.
- Step-through an interactive board to play through each line.

### Spaced-Repetition Puzzles
- After completing a lesson, the key positions are converted into recall puzzles.
- Puzzles ask the user to find the correct move **and explain why** (typed or spoken via Web Speech Recognition API).
- Scheduled using the **SM-2 (SuperMemo 2)** algorithm so difficult positions resurface more often and mastered positions fade to longer intervals.

### Progress Dashboard
- Track lesson completion, puzzle accuracy, and streak data.
- Per-opening success heatmap (e.g. strong in the Sicilian, weak in the Caro-Kann).
- Historical improvement curves (accuracy over time, interval growth).
- Strength & weakness report generated periodically.

### Voice Interaction
- Users can dictate answers to puzzle explanations using the browser's SpeechRecognition API.
- Audio cues narrate move reasoning during lessons via SpeechSynthesis.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      CLIENT (SPA)                        │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │  Lessons UI │  │  Puzzles UI  │  │  Dashboard UI  │   │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘   │
│         │                │                  │            │
│  ┌──────┴────────────────┴──────────────────┴──────-──┐  │
│  │              React + React Router                  │  │
│  │         react-chessboard  ·  chess.js              │  │
│  │         Web Speech API (TTS + STT)                 │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │  Firebase SDK
┌───────────────────────────┼──────────────────────────────┐
│                     FIREBASE BACKEND                     │
│                           │                              │
│  ┌────────────────────────┼───────────────────────────┐  │
│  │             Cloud Firestore (Database)             │  │
│  │  users · lessons · puzzles · reviews · progress    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │            Firebase Authentication                 │  │
│  │        Email/Password · Google · GitHub            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │           Cloud Functions (Node.js)                │  │
│  │  • SM-2 scheduling engine                          │  │
│  │  • AI explanation generator (Claude API)           │  │
│  │  • Progress aggregation / analytics                │  │
│  │  • Lichess PGN ingestion pipeline                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │            Firebase Hosting (SPA)                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│               ONE-TIME DATA PIPELINE                     │
│                                                          │
│  Lichess DB (PGN) ──► Node parser ──► Claude API         │
│                        (chess.js)      (explanations)    │
│                            │                             │
│                            ▼                             │
│                     Cloud Firestore                      │
│                  (lessons + puzzles)                     │
└──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | [React](https://react.dev/) (via Vite) | SPA with component-based UI |
| **Chess Board** | [react-chessboard](https://github.com/Clariity/react-chessboard) | Interactive board visualization |
| **Chess Logic** | [chess.js](https://github.com/jhlywa/chess.js) | Move validation, PGN/FEN parsing, game state |
| **Spaced Repetition** | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | SM-2 / FSRS scheduling algorithm |
| **Routing** | [React Router](https://reactrouter.com/) | Client-side navigation |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS framework |
| **Charts** | [Recharts](https://recharts.org/) | Dashboard visualizations |
| **Auth** | [Firebase Auth](https://firebase.google.com/products/auth) | User authentication (Email, Google, GitHub) |
| **Database** | [Cloud Firestore](https://firebase.google.com/products/firestore) | NoSQL document database |
| **Backend Logic** | [Cloud Functions](https://firebase.google.com/products/functions) | Serverless API endpoints & scheduled jobs |
| **Hosting** | [Firebase Hosting](https://firebase.google.com/products/hosting) | CDN-backed static hosting |
| **AI Explanations** | [Anthropic Claude API](https://docs.anthropic.com/) | Generate move explanations from positions |
| **Voice I/O** | Web Speech API | Speech-to-text (answers) & text-to-speech (narration) |
| **PGN Parsing** | [pgn-parser](https://github.com/mliebelt/pgn-parser) | Parse Lichess PGN database exports |

---

## Project Structure

```
chess_openings/
├── public/                        # Static assets
│   └── index.html
├── src/
│   ├── main.jsx                   # App entry point
│   ├── App.jsx                    # Root component + router
│   ├── components/
│   │   ├── Board/
│   │   │   ├── ChessBoard.jsx     # react-chessboard wrapper
│   │   │   └── MoveHistory.jsx    # Move list sidebar
│   │   ├── Lessons/
│   │   │   ├── LessonList.jsx     # Browse openings catalog
│   │   │   ├── LessonView.jsx     # Step-through lesson player
│   │   │   └── MoveExplanation.jsx# AI explanation card + audio
│   │   ├── Puzzles/
│   │   │   ├── PuzzleQueue.jsx    # Daily review queue
│   │   │   ├── PuzzleCard.jsx     # Single puzzle interaction
│   │   │   └── AnswerInput.jsx    # Text + voice answer input
│   │   ├── Dashboard/
│   │   │   ├── Dashboard.jsx      # Main dashboard page
│   │   │   ├── ProgressChart.jsx  # Accuracy over time
│   │   │   ├── OpeningHeatmap.jsx # Per-opening strength map
│   │   │   └── StreakTracker.jsx  # Daily streak display
│   │   ├── Auth/
│   │   │   ├── Login.jsx
│   │   │   └── Signup.jsx
│   │   └── Layout/
│   │       ├── Navbar.jsx
│   │       └── Sidebar.jsx
│   ├── hooks/
│   │   ├── useChessGame.js        # chess.js state management
│   │   ├── useSpeech.js           # TTS + STT hook
│   │   ├── useSpacedRepetition.js # SM-2 scheduling logic
│   │   └── useAuth.js             # Firebase auth hook
│   ├── services/
│   │   ├── firebase.js            # Firebase app initialization
│   │   ├── firestore.js           # Firestore CRUD helpers
│   │   ├── auth.js                # Auth service layer
│   │   └── api.js                 # Cloud Functions client
│   ├── lib/
│   │   ├── sm2.js                 # SM-2 algorithm implementation
│   │   └── pgn.js                 # PGN parsing utilities
│   ├── contexts/
│   │   └── AuthContext.jsx        # Auth state provider
│   └── styles/
│       └── globals.css            # Tailwind base + custom styles
├── functions/                     # Firebase Cloud Functions
│   ├── package.json
│   ├── index.js                   # Function entry points
│   ├── src/
│   │   ├── ingest/
│   │   │   ├── parseLichess.js    # Stream-parse Lichess PGN files
│   │   │   └── generateLessons.js # Send positions to Claude, store results
│   │   ├── review/
│   │   │   ├── scheduler.js       # SM-2 next-review calculator
│   │   │   └── evaluator.js       # Grade user answers (with AI assist)
│   │   ├── analytics/
│   │   │   └── aggregate.js       # Periodic progress aggregation
│   │   └── utils/
│   │       └── claude.js          # Anthropic API client wrapper
│   └── .env                       # Function-level secrets (not committed)
├── scripts/
│   ├── ingest.js                  # CLI runner for Lichess ingestion
│   └── seed.js                    # Seed Firestore with sample data
├── .env.example                   # Required environment variables
├── .gitignore
├── firebase.json                  # Firebase project configuration
├── firestore.rules                # Firestore security rules
├── firestore.indexes.json         # Composite index definitions
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── README.md
```

---

## Data Pipeline

The lesson content is generated **once** via an offline ingestion pipeline:

### Step 1 — Download Lichess Database
Download PGN exports from https://database.lichess.org/ (e.g., rated games ≥ 2200 Elo or master games).

### Step 2 — Parse & Extract Opening Lines
```
lichess_db.pgn
  │
  ▼  pgn-parser + chess.js
  │
  ├── Group games by ECO code / opening name
  ├── Extract the first N moves of each main line
  ├── Identify candidate moves at each branching point
  └── Deduplicate transpositions
```

### Step 3 — Generate AI Explanations
For each opening line and each key position, call the Claude API with a prompt like:

```
You are a chess instructor. Given this position (FEN: ...),
the main move is Nf3. Explain:
1. Why this move is the best choice in this position.
2. What are the main alternatives and why are they weaker?
3. What is the strategic plan after this move?
Keep the explanation concise (3-5 sentences) and suitable for
an intermediate player.
```

### Step 4 — Store in Firestore
Each opening becomes a `lesson` document with an ordered array of positions. Each position references its explanation text and generates a corresponding `puzzle` document.

---

## Core Modules

### SM-2 Spaced Repetition Engine

Each puzzle card tracks:

| Field | Type | Description |
|---|---|---|
| `easeFactor` | `number` | Starts at 2.5; adjusted after each review |
| `interval` | `number` | Days until next review |
| `repetitions` | `number` | Consecutive correct answers |
| `nextReviewDate` | `Timestamp` | When this card is next due |
| `quality` | `number` | Last review quality grade (0–5) |

**Grading scale:**
- **5** — Perfect response, correct move + correct reasoning
- **4** — Correct move, partial reasoning
- **3** — Correct move, poor/no reasoning
- **2** — Incorrect move, but recognized the right idea
- **1** — Incorrect move, vague reasoning
- **0** — Complete blackout

The `ts-fsrs` library handles scheduling. A thin wrapper in `lib/sm2.js` maps our grading scale to the library's input format.

### Voice Interaction

```
┌────────────────────┐     ┌───────────────────────┐
│  SpeechRecognition  │────►│  Answer text (string)│
│  (Web Speech API)   │     │  → sent for grading  │
└────────────────────┘     └───────────────────────┘

┌────────────────────┐     ┌───────────────────────┐
│  SpeechSynthesis   │◄────│  Explanation text     │
│  (Web Speech API)  │     │  (from lesson data)   │
└────────────────────┘     └───────────────────────┘
```

- **STT (Speech-to-Text):** Used in puzzle mode so users can speak their reasoning. The transcript is captured and submitted alongside their chosen move.
- **TTS (Text-to-Speech):** Used in lesson mode to narrate move explanations as the user steps through positions.

---

## Database Schema

### Firestore Collections

#### `users/{userId}`
```json
{
  "uid": "string",
  "email": "string",
  "displayName": "string",
  "createdAt": "timestamp",
  "settings": {
    "dailyGoal": 10,
    "voiceEnabled": true,
    "theme": "dark"
  }
}
```

#### `lessons/{lessonId}`
```json
{
  "id": "string",
  "title": "Sicilian Defense: Najdorf Variation",
  "eco": "B90",
  "color": "black",
  "difficulty": "intermediate",
  "description": "string",
  "tags": ["sicilian", "open-game", "sharp"],
  "positions": [
    {
      "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      "move": "c5",
      "moveNumber": 1,
      "explanation": "The Sicilian Defense immediately fights for the center...",
      "alternatives": [
        { "move": "e5", "reason": "Solid but symmetrical..." },
        { "move": "e6", "reason": "The French Defense..." }
      ]
    }
  ],
  "createdAt": "timestamp",
  "totalPositions": 12
}
```

#### `puzzles/{puzzleId}`
```json
{
  "id": "string",
  "lessonId": "string",
  "fen": "string",
  "correctMove": "Nf3",
  "explanation": "string",
  "difficulty": "intermediate",
  "positionIndex": 3
}
```

#### `users/{userId}/reviews/{reviewId}`
```json
{
  "puzzleId": "string",
  "lessonId": "string",
  "easeFactor": 2.5,
  "interval": 1,
  "repetitions": 0,
  "nextReviewDate": "timestamp",
  "lastReviewDate": "timestamp",
  "quality": 4,
  "history": [
    {
      "date": "timestamp",
      "quality": 4,
      "moveChosen": "Nf3",
      "answerText": "Controls the center and develops a piece...",
      "correct": true
    }
  ]
}
```

#### `users/{userId}/progress/{periodId}`
```json
{
  "period": "2026-02",
  "totalReviews": 142,
  "correctMoves": 118,
  "accuracy": 0.83,
  "lessonsCompleted": 5,
  "currentStreak": 12,
  "longestStreak": 18,
  "openingBreakdown": {
    "B90": { "reviews": 30, "accuracy": 0.90 },
    "C50": { "reviews": 22, "accuracy": 0.68 }
  }
}
```

---

## API Design

### Cloud Functions Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/lessons` | List all lessons (with filters) |
| `GET` | `/api/lessons/:id` | Get a single lesson with positions |
| `GET` | `/api/puzzles/due` | Get user's due puzzle queue for today |
| `POST` | `/api/puzzles/:id/review` | Submit a review (move + reasoning) |
| `GET` | `/api/progress/summary` | Get user's progress summary |
| `GET` | `/api/progress/openings` | Per-opening accuracy breakdown |
| `POST` | `/api/ingest/run` | Trigger Lichess ingestion (admin only) |

### Callable Functions

| Function | Trigger | Description |
|---|---|---|
| `scheduleDailyReviews` | Pub/Sub (daily cron) | Precompute each user's daily queue |
| `aggregateProgress` | Pub/Sub (weekly cron) | Roll up review data into progress docs |
| `gradeAnswer` | HTTPS Callable | Send user's typed/spoken answer to Claude for semantic grading |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm or yarn
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Auth, Functions, and Hosting enabled
- An Anthropic API key (for lesson generation & answer grading)

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/chess_openings.git
cd chess_openings

# Install frontend dependencies
npm install

# Install Cloud Functions dependencies
cd functions && npm install && cd ..

# Copy environment template
cp .env.example .env
# Edit .env with your Firebase config and API keys

# Start the development server
npm run dev

# In a separate terminal, start the Firebase emulators
firebase emulators:start
```

### Running the Ingestion Pipeline

```bash
# Download a Lichess PGN file first (see https://database.lichess.org/)
# Then run the ingestion script:
node scripts/ingest.js --input ./data/lichess_db.pgn --max-games 1000

# Or seed with sample data for development:
node scripts/seed.js
```

---

## Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Anthropic API (used in Cloud Functions & ingestion scripts)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Build + deploy to Firebase Hosting |
| `npm run deploy:functions` | Deploy Cloud Functions only |
| `npm run ingest` | Run Lichess PGN ingestion pipeline |
| `npm run seed` | Seed Firestore with sample data |

---

## Roadmap

- [x] Project architecture & README
- [ ] Firebase project setup & configuration
- [ ] Authentication (Email, Google, GitHub)
- [ ] Lichess PGN ingestion pipeline
- [ ] Claude API integration for lesson generation
- [ ] Lesson browser & interactive board player
- [ ] Audio narration (TTS) for lessons
- [ ] Puzzle engine with SM-2 scheduling
- [ ] Voice input (STT) for puzzle answers
- [ ] AI-assisted answer grading
- [ ] Progress dashboard with charts
- [ ] Opening strength/weakness heatmap
- [ ] Daily streak tracking & notifications
- [ ] Mobile-responsive design
- [ ] PWA support for offline review
- [ ] Multiplayer opening quiz mode

---

## License

MIT

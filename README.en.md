<div align="center">

# INFINITI 无限连接

**A learning assistant that thinks in relationships: understand a book, untangle a course**

An LLM reads your study material end to end and turns its people, concepts and ideas into an explorable relationship graph, with every relation linked back to the passage it came from

14 works included (the Four Great Classical Novels, *Strange Tales from a Chinese Studio*, six English classics read in the original, the *Analects*, the *Records of the Grand Historian*, and a middle-school math curriculum): **13,784** entries, **44,425** relations

[![License: MIT](https://img.shields.io/badge/license-MIT-b23a26.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sencloud/Infiniti?style=flat&color=b23a26)](https://github.com/sencloud/Infiniti/stargazers)
![Node.js 20+](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Neo4j 5](https://img.shields.io/badge/Neo4j-5-4581C3?logo=neo4j&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white)
![DeepSeek](https://img.shields.io/badge/LLM-DeepSeek-4D6BFE)

[简体中文](README.md) | English

<img src="docs/images/hero.webp" alt="3D character graph of Romance of the Three Kingdoms" width="100%">

</div>

---

*Dream of the Red Chamber* has hundreds of characters tied together by kinship, marriage and servitude. A math course builds every theorem on a stack of earlier ones. A new technology's docs throw dozens of unfamiliar concepts at you at once. In each case the hard part is seeing how things connect.

**Infiniti** is a reading and learning tool. It has an LLM read the material unit by unit, extract people, concepts and events along with the relations between them, store everything in Neo4j, and present it as a graph you can search, expand, and click through to the original text. See the whole structure first, then follow the relations deeper, checking the source at every step.

> The UI is bilingual. Most source texts are Chinese; the World Classics shelf reads English novels from Project Gutenberg in the original. Entity types, predicates and rules are configured per graph.

## Use cases

| Scenario | What it helps with | Status |
|----------|--------------------|--------|
| **Reading a book** | Untangle characters and plotlines, see which plot clusters make up the book, spot reversals and gaps worth a closer read | Four Great Classical Novels, *Strange Tales*, *Analects*, *Records of the Grand Historian*, and six English classics (*Pride and Prejudice*, *Jane Eyre*, *Sherlock Holmes*…) included |
| **Learning a course** | Link concepts as prerequisite → theorem → application, see what each one depends on and leads to, jump to the textbook page | Middle-school math (6 volumes) included |
| **Learning a technology · preparing for an exam** | The same pipeline works on technical docs, tutorials, syllabi and lecture notes: import the material to build your own graph | Bring your own material, see [Adding material](#adding-material) |

Built for students reading set texts and studying textbooks, university students and exam candidates organizing large amounts of material, developers and professionals picking up a new technology, readers who want to go deeper, and teachers and parents preparing lessons.

## Features

<table>
<tr>
<td width="50%" valign="top">

### Relation explorer

Search for Jia Baoyu and all 1,590 of his relations unfold at once. Click a node for identity and aliases, click an edge to see how two people are related, right-click to keep expanding. Additional views cover path finding, tie strength, communities, timelines and flows.

</td>
<td width="50%"><img src="docs/images/explore-hlm.jpg" alt="Relation explorer, Dream of the Red Chamber"></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/evidence-hlm.jpg" alt="Evidence highlighting"></td>
<td width="50%" valign="top">

### Every relation is sourced

Click a relation to jump to the chapter it came from, with the supporting sentences highlighted and the extraction confidence shown. Claims can be checked against the text instead of taken on faith.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Semantic galaxy

Passages are embedded, projected with PCA + UMAP and clustered. The 120 chapters of *Dream of the Red Chamber* fall into 29 named plot clusters (poetry club gatherings, Wang Xifeng's schemes, the Baoyu–Daiyu romance…), with a per-chapter density chart underneath.

</td>
<td width="50%"><img src="docs/images/galaxy-hlm.jpg" alt="Semantic galaxy"></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/clues-sanguo.jpg" alt="Clue detection"></td>
<td width="50%" valign="top">

### Clue detection

Rule-based scans flag relation reversals, appearances after death, long absences and conflicting origins: Hou Cheng serves Lü Bu and later betrays him; Guan Yu and Xu Huang go from rescuer and rescued to enemies. *Three Kingdoms* alone yields 213 such clues.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Communities

Louvain community detection groups the 3,682 entities of the *Records of the Grand Historian* into 40 factions such as the Chu–Han military clique, Emperor Wu's court, the Spring and Autumn hegemons, and Confucius's disciples.

</td>
<td width="50%"><img src="docs/images/community-shiji.jpg" alt="Communities"></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/explore-math.jpg" alt="Math concept network"></td>
<td width="50%" valign="top">

### Textbook concept network

137 sections across 6 middle-school math textbooks, linked by prerequisite, derivation and application. Open the Pythagorean theorem to see what it depends on, what follows from it, and the textbook page it appears on. Textbooks get their own rules: inverted prerequisites, circular dependencies, orphan concepts, long cross-volume jumps.

</td>
</tr>
</table>

Light and dark themes, and a mobile layout, are included.

## Included material

| Material | Units | Entries | Relations | Clusters |
|-------|------:|---------:|----------:|---------:|
| *Water Margin* 水浒传 | 120 chapters | 1,680 | 8,704 | 29 |
| *Journey to the West* 西游记 | 100 chapters | 1,015 | 3,473 | 9 |
| *Dream of the Red Chamber* 红楼梦 | 120 chapters | 1,056 | 6,956 | 29 |
| *Romance of the Three Kingdoms* 三国演义 | 120 chapters | 1,926 | 7,666 | 28 |
| *Strange Tales from a Chinese Studio* 聊斋志异 | 494 stories | 2,764 | 3,702 | 30 |
| *Pride and Prejudice* | 61 chapters | 96 | 2,168 | 8 |
| *Jane Eyre* | 38 chapters | 162 | 1,046 | 13 |
| *The Adventures of Sherlock Holmes* | 12 stories | 283 | 506 | 19 |
| *The Great Gatsby* | 9 chapters | 106 | 292 | 10 |
| *Romeo and Juliet* | 24 scenes | 45 | 357 | 8 |
| *Alice’s Adventures in Wonderland* | 12 chapters | 56 | 118 | 8 |
| *Analects* 论语 | 20 books | 105 | 277 | 10 |
| *Records of the Grand Historian* 史记 | 130 chapters | 3,682 | 7,736 | 10 |
| Middle-school math 初中数学 (Sukejiao, 6 vols) | 137 sections | 808 | 1,424 | 21 |

Want another book or course? Open an [issue](https://github.com/sencloud/Infiniti/issues), or follow [Adding material](#adding-material) below.

## Quick start

Requirements: Node.js 20+, Docker (for Neo4j), and a [DeepSeek API key](https://platform.deepseek.com/).

```bash
git clone https://github.com/sencloud/Infiniti.git
cd Infiniti

# Windows one-click: installs deps, builds the frontend, starts Neo4j + web + worker, opens the browser
start.bat
```

Or manually:

```bash
docker compose up -d                  # Neo4j
npm install
npx playwright-core install chromium  # headless browser used by the crawler
cp .env.example .env                  # set DEEPSEEK_API_KEY
npm --prefix web install && npm run web:build

npm start                             # web server at http://localhost:3100
npm run worker                        # pipeline worker (separate terminal)
```

A fresh database is empty. The repo ships the source texts and the LLM extraction results for all 14 works, so one command loads them and computes the galaxy and graph analytics without re-running extraction:

```bash
npm run kg:restore                    # all graphs; or just one: npm run kg:restore -- hongloumeng
```

## Adding material

A book, a textbook series, a set of technical docs or exam notes all run through the same resumable pipeline: crawl → seeds → extract → load → build.

1. Add a material definition in `src/kg/domains/index.js`: name, source URL, unit (chapter / story / section), entity types (people, concepts, theorems, terms…), predicates, clue rules
2. Run `npm run kg:run -- <material-id>`
3. The homepage card shows build progress; start studying once it finishes

English books on [Project Gutenberg](https://www.gutenberg.org/) use the `foreign({...})` factory: give the ebook number and unit, and add a chapter-splitting rule in `src/scripts/kg/gutenberg.js`. Entries keep their names from the text, with a Chinese name and note alongside; evidence quotes the English directly, and passages are embedded with multilingual-e5-small. `npm run kg:media -- <id>` then places the illustrated edition's plates in their chapters, has the LLM tag who each one shows, adds Wikidata portraits, and maps Bilibili adaptations to chapters.

For textbooks, the middle-school math definition (`math`) is a working template that maps concepts, prerequisites and textbook pages. To look up a single person or topic quickly, the homepage's free exploration page (`/people/`) builds a graph from encyclopedia sources on demand.

## How it works

```
source text ──► chunk ──► LLM extraction (entities, relations, evidence spans)
                                │
                                ▼
                     Neo4j: Entity / Claim / Segment
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  bge-small-zh embeddings   Louvain communities    clue rules
  PCA + UMAP + KMeans       hubs, tie strength     (reversals, gaps…)
  LLM-named clusters
         │                      │                      │
         └──────────► Express API ◄────────────────────┘
                          │
                          ▼
          React + antd UI, Three.js 3D force layout
```

- **Backend**: Node.js 20, Express 5
- **Database**: Neo4j 5 (Cypher + vector index)
- **Extraction**: DeepSeek via the OpenAI-compatible API
- **Analytics**: local bge-small-zh / multilingual-e5-small embeddings, UMAP, KMeans, Louvain (graphology)
- **Crawling**: Playwright headless browser with source fallback
- **Frontend**: Vite + React + antd; Three.js with a hand-written force layout

See the [Chinese README](README.md#技术细节) for the full pipeline commands, configuration and project layout.

## License

Code is released under the [MIT License](LICENSE).

Data: classical texts come from [5000yan](https://www.5000yan.com/) and are in the public domain. English texts and their illustrations come from [Project Gutenberg](https://www.gutenberg.org/) and are in the public domain. Historical paintings for *Water Margin* and character portraits for the English books come from Wikimedia Commons with attribution shown on each card. Bilibili videos are embedded from the original uploads and remain with their rights holders. Middle-school math textbook pages and transcriptions remain the copyright of the publisher and are included for study and research only. Please respect each source's terms and keep crawl rate limits in place.

## Contributing

Issues and PRs are welcome: books you want to see, extraction errors, new clue rules, UI improvements. If you find the project useful, a star helps others discover it.

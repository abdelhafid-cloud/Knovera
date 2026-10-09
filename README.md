# Knovera

Knovera est une plateforme RAG multi-organisations. Chaque organisation indexe ses documents et interroge ses assistants. Les réponses s'appuient sur les knowledge bases de l'organisation, avec des rôles séparés et un journal d'audit.

## Rôles

| Rôle | Rôle dans le produit |
|---|---|
| Super admin | Crée les organisations, les knowledge bases, les documents et les assistants. Gère la plateforme. |
| Admin d'organisation | Voit son organisation, crée les utilisateurs et leur attache des assistants. |
| Utilisateur | Discute uniquement avec les assistants qui lui ont été attribués. |

Un assistant a une couleur de bandeau, choisie à la création. Cette couleur s'affiche dans l'en-tête du chat.

## Architecture

| Partie | Rôle |
|---|---|
| `frontend/` | Interface Next.js (port 3000) |
| `backend/` | API Flask (port 5000) : comptes, organisations, chat |
| `pipeline/` | Worker d'indexation, séparé de l'API |
| PostgreSQL | Données métier |
| Redis | File des jobs d'indexation |
| MinIO | Fichiers uploadés |
| Qdrant | Collections vectorielles, une par knowledge base |
| Cohere | Embeddings et rerank |
| OpenAI, Anthropic ou OpenRouter | Génération des réponses |
| Mistral OCR | Texte des PDF et images, si la clé est renseignée |

L'API ne fait pas l'indexation elle-même. Elle envoie le document dans la file Redis `pipeline`. Le worker le télécharge, en extrait le texte, le découpe, calcule les embeddings et les écrit dans Qdrant.

## Prérequis

- Docker, pour PostgreSQL, Redis, MinIO et Qdrant
- Python 3.12 pour le pipeline
- Node.js 20 ou plus pour le frontend
- Un fichier `.env` à la racine, copié depuis `.env.example`

Ne versionnez pas `.env`, ni les environnements virtuels (`backend/.venv`, `pipeline/.venv`, `pipeline/.venv312`). En déploiement, les dépendances s'installent depuis `requirements.txt` dans une image Python 3.12.

## Démarrage local

Depuis la racine du dépôt.

```powershell
copy .env.example .env
docker compose up -d
```

Renseignez au minimum les clés utilisées : `COHERE_API_KEY`, et une clé LLM (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou `OPENROUTER_API_KEY`). `MISTRAL_API_KEY` sert à l'OCR. Changez `SECRET_KEY`, `JWT_SECRET_KEY` et le mot de passe du super admin avant tout usage autre que local.

Backend :

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\flask --app run seed
```

`flask --app run seed` crée les rôles et le super admin définis par `SEED_SUPER_ADMIN_EMAIL` et `SEED_SUPER_ADMIN_PASSWORD`.

Pipeline :

```powershell
py -3.12 -m venv pipeline\.venv
pipeline\.venv\Scripts\pip install -r pipeline\requirements.txt
```

Frontend :

```powershell
cd frontend
npm install
```

Trois terminaux, depuis la racine :

```powershell
powershell -File scripts/start-backend.ps1
powershell -File scripts/start-pipeline.ps1
powershell -File scripts/start-frontend.ps1
```

- Interface : http://localhost:3000
- API : http://localhost:5000
- Console MinIO : http://localhost:9001

Sans le terminal pipeline, les documents restent en attente ou passent en échec. `PIPELINE_SYNC_FALLBACK` doit rester à `0`.

## Formats de documents

PDF, DOCX, TXT, XLSX, PNG, JPG, JPEG et WEBP. La taille maximale par défaut est de 25 Mo (`MAX_UPLOAD_SIZE_MB`).

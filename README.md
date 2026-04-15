# NIRA Workspace

This repository is organized as a clean monorepo-style workspace for the NIRA product.

## Structure

- `frontend/NIRA-repo` - the Vite/React application used by patient, doctor, admin, and nurse flows
- `backend/guna_emr` - the EMR and integration services
- `.github/workflows` - frontend review and GitHub Pages deployment workflows
- `docs/DEPLOYMENT.md` - deployment guidance for Vercel, GitHub Pages, and VM hosting

## Local development

Frontend:

```powershell
cd frontend/NIRA-repo
npm ci
npm run dev
```

Optional local Mongo-backed state bridge:

```powershell
cd frontend/NIRA-repo
npm run mongo:api
```

The frontend still works with demo data when `VITE_MONGO_STATE_API_URL` is not configured.

## Deployment guidance

- Vercel is the easiest preview path for the current dummy-data frontend.
- GitHub Pages is supported for demo builds and static review links.
- A VM deployment on AWS or Google Cloud is the right final path when the frontend must talk to the local Mongo state API and backend services.

Start with [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before connecting production infrastructure.

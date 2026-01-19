# AEM Content Migration Tool

A modern web application to assist in migrating content from legacy AEM packages to a target AEM instance. This tool provides analysis of source packages, automated mapping recommendations, and direct content migration capabilities.

## Prerequisites

- **Node.js**: Version 18 or higher is recommended.
- **AEM Instance**: Target AEM instance (e.g., localhost:4502) running and accessible.

## Project Structure

- `client/`: React-based frontend application (Vite).
- `server/`: Node.js/Express backend server.
- `extraction/`: Temporary storage for extracted package content.
- `uploads/`: Temporary storage for uploaded zip files.

---

## Windows Deployment & Execution

Follow these steps to set up and run the application on a Windows system.

### 1. Installation

Open **PowerShell** or **Command Prompt** as Administrator (optional but recommended for some permission issues) and navigate to the project root folder.

```powershell
# 1. Install Server Dependencies
cd server
npm install

# 2. Install Client Dependencies
cd ..\client
npm install
cd ..
```

### 2. Build Frontend

The frontend needs to be built so the backend can serve the static files.

```powershell
cd client
npm run build
cd ..
```

### 3. Start the Server

The backend server serves both the API and the built frontend files.

```powershell
cd server
node index.js
```

You should see the message: `Server is running on port 3001`

### 4. Access the Application

Open your browser and navigate to:
[http://localhost:3001](http://localhost:3001)

---

## macOS / Linux Deployment

### 1. Installation

```bash
# Install dependencies for both server and client
cd server && npm install
cd ../client && npm install && cd ..
```

### 2. Build & Run

```bash
# Build Frontend
cd client && npm run build && cd ..

# Start Server
cd server && node index.js
```

## Usage Guide

1.  **Source Step**: Upload your AEM Content Package (`.zip`). The tool will analyze it and provide an "Analysis Report".
2.  **Analysis**: Download the `analysis_report_ID.csv`. Open it to review Templates and Components found.
3.  **Mapping**: 
    *   Create a mapping file (or edit the analysis report) to map Source -> Target.
    *   Format: CSV with columns `Type,Source,Target,Properties`.
    *   For Templates: Map property usage if needed (e.g., `jcr:title=pageTitle`).
    *   For Components: Map resource types and properties (e.g., `sitelogo=logo`).
4.  **Configuration**:
    *   Upload your finalized Mapping Report CSV.
    *   Enter Target AEM credentials (URL, Username, Password).
    *   Enter Target Root Path (e.g., `/content/mysite`).
5.  **Migrate**: Click "Start Migration" to begin the automated content creation process.

## Troubleshooting

- **Port Conflicts**: If port 3001 is busy, modify `server/index.js` or set `PORT` environment variable.
- **Windows Path Issues**: The tool uses Node's `path` module to handle cross-platform file paths automatically.
- **AEM Connection**: Ensure CORS settings on AEM allow requests from `localhost:3001` or disable strict CORS on AEM for migration testing.

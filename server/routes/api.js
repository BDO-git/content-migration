const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PackageService = require('../services/packageService');
const TreeService = require('../services/treeService');
const TransformService = require('../services/transformService');
const AnalysisService = require('../services/analysisService');
const MigrationService = require('../services/migrationService');
const AutoMapService = require('../services/autoMapService');

// Setup Multer for uploads
const upload = multer({ dest: path.join(__dirname, '../uploads/') });

// Services Instances
const packageService = new PackageService(
    path.join(__dirname, '../uploads/'),
    path.join(__dirname, '../../extraction/')
);
const treeService = new TreeService();
const transformService = new TransformService();
const analysisService = new AnalysisService();
const autoMapService = new AutoMapService();

// Routes

// 1. Upload Package
router.post('/upload', upload.single('package'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // Generate a friendly ID: originalName_hash
        const safeName = path.parse(req.file.originalname).name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const id = `${safeName}_${req.file.filename}`;

        const result = await packageService.extractPackage(req.file.path, id);
        res.json({ success: true, daa: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 1.5 Auto Map
router.post('/auto-map', upload.fields([
    { name: 'templateList', maxCount: 1 },
    { name: 'componentList', maxCount: 1 },
    { name: 'analysisReport', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.templateList || !req.files.componentList || !req.files.analysisReport) {
            return res.status(400).json({ error: 'Missing required files' });
        }

        const result = await autoMapService.generateMappings(
            req.files.templateList[0].path,
            req.files.componentList[0].path,
            req.files.analysisReport[0].path
        );

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Analyze (Get Tree) - Optional Step if UI wants to show tree before migration
// Usually we do this as part of migration or preview
router.get('/tree/:id', async (req, res) => {
    try {
        const extractionPath = path.join(__dirname, '../../extraction/', req.params.id);
        const jcrRoot = path.join(extractionPath, 'jcr_root');

        if (!fs.existsSync(jcrRoot)) {
            return res.status(404).json({ error: 'Package not found or invalid' });
        }

        const tree = await treeService.buildTree(jcrRoot);
        res.json({ success: true, tree });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2.5 Analyze Package Content (Templates & Components)
router.get('/analyze/:id', async (req, res) => {
    try {
        const extractionPath = path.join(__dirname, '../../extraction/', req.params.id);
        const jcrRoot = path.join(extractionPath, 'jcr_root');

        if (!fs.existsSync(jcrRoot)) {
            return res.status(404).json({ error: 'Package not found or invalid' });
        }

        // Reuse tree service to get structure
        const tree = await treeService.buildTree(jcrRoot);

        // Analyze
        const analysis = analysisService.analyze(tree);

        // Generate Report Files
        const reportPath = await analysisService.generateMarkdownReport(analysis, req.params.id);
        const csvPath = await analysisService.generateCSVReport(analysis, req.params.id);

        res.json({ success: true, analysis, reportPath, csvPath });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Run Migration (Preview/DryRun or Real)
router.post('/migrate', async (req, res) => {
    const {
        uploadId,
        sourceRoot, // e.g. /content/oldsite
        targetUrl,
        username,
        password,
        targetRoot, // e.g. /content/newsite
        templateMappings,
        componentMappings,
        dryRun
    } = req.body;

    if (!uploadId || !targetUrl || !targetRoot) {
        return res.status(400).json({ error: 'Missing required configuration' });
    }

    try {
        const extractionPath = path.join(__dirname, '../../extraction/', uploadId);
        const jcrRoot = path.join(extractionPath, 'jcr_root');

        // 1. Build Tree
        const rawTree = await treeService.buildTree(jcrRoot);

        // 2. Transform Tree
        const transformConfig = {
            sourceRoot,
            targetRoot,
            templateMappings,
            componentMappings
        };
        const transformedTree = transformService.transformTree(rawTree, transformConfig);

        // 3. Migrate
        const migrationService = new MigrationService(targetUrl, { username, password });
        const report = await migrationService.migrate(transformedTree, dryRun);

        res.json({ success: true, report });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

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
    { name: 'targetDefinitions', maxCount: 1 },
    { name: 'analysisReport', maxCount: 1 }
]), async (req, res) => {
    try {
        const { uploadId } = req.body;
        let analysisReportPath = null;

        // Validations
        if (!req.files || !req.files.targetDefinitions) {
            // If manual upload, check files. If uploadId, we still need targetDefinitions file.
            return res.status(400).json({ error: 'Target Definitions file is required' });
        }

        const targetDefPath = req.files.targetDefinitions[0].path;

        // Case A: Using Uploaded ID (Seamless Flow)
        if (uploadId) {
            console.log(`[AutoMap] Using UploadID: ${uploadId}`);
            const expectedCsvPath = path.join(__dirname, '../../', `analysis_report_${uploadId}.csv`);

            if (fs.existsSync(expectedCsvPath)) {
                // Report already exists
                analysisReportPath = expectedCsvPath;
            } else {
                // Need to generate report
                console.log(`[AutoMap] Report not found for ${uploadId}, generating...`);
                const extractionPath = path.join(__dirname, '../../extraction/', uploadId);
                const jcrRoot = path.join(extractionPath, 'jcr_root');

                if (!fs.existsSync(jcrRoot)) {
                    return res.status(404).json({ error: 'Linked Source Package not found on server.' });
                }

                const tree = await treeService.buildTree(jcrRoot);
                const analysis = analysisService.analyze(tree);
                analysisReportPath = await analysisService.generateCSVReport(analysis, uploadId);
            }

        }
        // Case B: Manual File Upload
        else if (req.files.analysisReport) {
            analysisReportPath = req.files.analysisReport[0].path;
        } else {
            return res.status(400).json({ error: 'Either Source Analysis file or Upload ID is required' });
        }

        console.log(`[AutoMap] Generating mappings using: ${analysisReportPath}`);
        const result = await autoMapService.generateMappings(
            targetDefPath,
            analysisReportPath
        );

        res.json({ success: true, data: result });
    } catch (error) {
        console.error(error);
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
        // const reportPath = await analysisService.generateMarkdownReport(analysis, req.params.id);
        const csvPath = await analysisService.generateCSVReport(analysis, req.params.id);

        res.json({ success: true, analysis, csvPath });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Run Migration (Preview/DryRun or Real)
const migrationService = require('../services/migrationService');

// 3. Run Migration
router.post('/migrate', upload.single('mappingReport'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Mapping Report file is required' });
        }

        const mappingReportPath = req.file.path;

        // When using FormData, objects come as JSON strings
        const targetConfig = JSON.parse(req.body.targetConfig);
        const uploadId = req.body.uploadId;

        const results = await migrationService.migrate(uploadId, mappingReportPath, targetConfig);

        res.json({ success: true, results });

    } catch (error) {
        console.error("Migration failed:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});



module.exports = router;

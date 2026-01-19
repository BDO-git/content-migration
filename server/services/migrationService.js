const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const axios = require('axios');
const FormData = require('form-data');

class MigrationService {
    constructor() {
        this.parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        this.builder = new xml2js.Builder();
    }

    async migrate(uploadId, mappingReportPath, targetConfig) {
        console.log(`[Migration] Starting migration for upload: ${uploadId}`);

        // 1. Parsing Mappings
        const mappings = await this.parseMappingReport(mappingReportPath);
        console.log(`[Migration] Loaded mappings: ${mappings.templates.size} templates, ${mappings.components.size} components`);

        // 2. Locate Source Content
        // Extraction path is usually server/extraction/<uploadId>
        const extractionPath = path.join(__dirname, '../../extraction', uploadId, 'jcr_root');

        if (!fs.existsSync(extractionPath)) {
            throw new Error(`Source content not found for ID: ${uploadId}`);
        }

        // 3. Traverse and Migrate
        const results = {
            processed: 0,
            created: 0,
            errors: []
        };

        try {
            await this.traverseAndMigrate(extractionPath, extractionPath, mappings, targetConfig, results);
        } catch (err) {
            console.error("Migration traversal failed", err);
            throw err;
        }

        return results;
    }

    async parseMappingReport(filePath) {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content.split('\n');

        const templates = new Map();
        const components = new Map();

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV parsing (assuming quotes are handled reasonably)
            // Use regex to handle quoted fields containing delimiters
            const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!parts || parts.length < 3) continue;

            const type = parts[0].replace(/"/g, '');
            const source = parts[1].replace(/"/g, '');
            const target = parts[2].replace(/"/g, '');
            const propsStr = parts[3] ? parts[3].replace(/"/g, '') : '';

            if (type === 'Template' || type === 'Component') {
                // Parse properties "s=t;s2=t2"
                const propMap = {};
                if (propsStr) {
                    propsStr.split(';').forEach(pair => {
                        const [s, t] = pair.split('=');
                        if (s && t) propMap[s.trim()] = t.trim();
                    });
                }

                if (type === 'Template') {
                    templates.set(source, {
                        targetPath: target,
                        properties: propMap
                    });
                } else {
                    components.set(source, {
                        targetPath: target,
                        properties: propMap
                    });
                }
            }
        }

        return { templates, components };
    }

    async traverseAndMigrate(currentPath, rootPath, mappings, config, results) {
        const stats = await fs.promises.stat(currentPath);

        if (stats.isDirectory()) {
            const children = await fs.promises.readdir(currentPath);

            // Check for .content.xml aka JCR Node
            if (children.includes('.content.xml')) {
                await this.processNode(currentPath, rootPath, mappings, config, results);
            }

            for (const child of children) {
                if (child === '.content.xml' || child === 'META-INF') continue;
                await this.traverseAndMigrate(path.join(currentPath, child), rootPath, mappings, config, results);
            }
        }
    }

    async processNode(nodePath, rootPath, mappings, config, results) {
        const xmlPath = path.join(nodePath, '.content.xml');
        const xmlContent = await fs.promises.readFile(xmlPath, 'utf8');

        try {
            const result = await this.parser.parseStringPromise(xmlContent);

            // Determine relative path for target
            // relPath is the path from the jcr_root, e.g. /content/wknd/us/en
            let relPath = nodePath.replace(rootPath, '');

            let finalTargetPath = relPath;

            // PATH REBASING LOGIC
            // If user provided a Target Root (e.g. /content/mysite)
            // AND we have a known Source Root (e.g. /content/wknd)
            // We should rewrite /content/wknd/us/en -> /content/mysite/us/en

            if (config.targetRoot && config.sourceRoot) {
                if (relPath.startsWith(config.sourceRoot)) {
                    finalTargetPath = relPath.replace(config.sourceRoot, config.targetRoot);
                } else {
                    // Fallback: If path doesn't start with source root (e.g. /conf vs /content), 
                    // maybe we shouldn't move it, or maybe we append?
                    // For safety, if it's content, let's try to anchor it.
                    // But if it's mismatching, we might just keep it as is or log a warning.
                    // Let's assume content matches source root.
                }
            } else if (config.targetRoot) {
                // No source root known? Just try to use targetRoot?
                // That's risky. Let's stick to relPath if no sourceRoot match.
            }

            results.processed++;

            const rootNode = result['jcr:root'];
            if (!rootNode) return;

            // --- TRANSFORM ---
            const transformedData = this.transformNode(rootNode, mappings);

            // POST to AEM
            const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
            await this.createNode(config.targetUrl, finalTargetPath, transformedData, auth);

            results.created++;

        } catch (e) {
            console.error(`Error processing ${xmlPath}`, e);
            results.errors.push({ path: xmlPath, error: e.message });
        }
    }

    transformNode(node, mappings) {
        if (!node || typeof node !== 'object') return node;

        const newNode = {};

        // 1. Process Properties
        for (const [key, value] of Object.entries(node)) {
            let newKey = key;
            let newValue = value;

            // Recursively transform children
            if (typeof value === 'object' && !Array.isArray(value)) {
                newNode[key] = this.transformNode(value, mappings);
                continue;
            }

            // --- MAPPING LOGIC ---

            // Check Resource Type Mapping
            if (key === 'sling:resourceType') {
                // Check if this component is mapped
                const currentRT = value;
                if (mappings.components.has(currentRT)) {
                    const mapData = mappings.components.get(currentRT);
                    newValue = mapData.targetPath; // Update Resource Type
                }
            }

            // Check Template Mapping
            if (key === 'cq:template') {
                const currentTpl = value;
                if (mappings.templates.has(currentTpl)) {
                    const tplMap = mappings.templates.get(currentTpl);
                    newValue = tplMap.targetPath;
                }
            }

            // Property Mapping (Component or Template based)
            let propertyMapped = false;

            // 1. Try Component Mapping first
            const originalResourceType = node['sling:resourceType'];
            if (originalResourceType && mappings.components.has(originalResourceType)) {
                const mapData = mappings.components.get(originalResourceType);
                if (mapData.properties && mapData.properties[key]) {
                    newKey = mapData.properties[key];
                    propertyMapped = true;
                }
            }

            // 2. Try Template Mapping (if not already mapped by component)
            // Note: Templates usually apply to the node containing cq:template (the page content)
            const originalTemplate = node['cq:template'];
            if (!propertyMapped && originalTemplate && mappings.templates.has(originalTemplate)) {
                const tplMap = mappings.templates.get(originalTemplate);
                if (tplMap.properties && tplMap.properties[key]) {
                    newKey = tplMap.properties[key];
                }
            }

            newNode[newKey] = newValue;
        }

        return newNode;
    }

    async createNode(targetUrl, nodePath, nodeData, auth) {
        const form = new FormData();
        this.flattenToFormData(form, nodeData);

        try {
            // Construct URL: targetUrl + nodePath
            let url = `${targetUrl}${nodePath}`;

            // console.log(`[POST] Creating node at ${url}`); // Debug

            await axios.post(url, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Basic ${auth}`
                }
            });
            return true;
        } catch (error) {
            const status = error.response ? error.response.status : 'Unknown';
            const statusText = error.response ? error.response.statusText : '';
            console.error(`Failed to create node ${nodePath}: ${status} ${statusText} - ${error.message}`);

            if (error.response && error.response.data) {
                // console.error("Response data:", error.response.data); // Helpful for detailed debug
            }
            return false;
        }
    }

    flattenToFormData(form, data, prefix = '') {
        for (const [key, value] of Object.entries(data)) {
            // Skip xmlns definitions in JSON
            if (key.startsWith('xmlns:')) continue;
            // Skip jcr:primaryType if it causes issues? No, usually required for new nodes.

            const propName = prefix ? `${prefix}/${key}` : key;

            if (typeof value === 'object' && value !== null) {
                this.flattenToFormData(form, value, propName);
            } else {
                form.append(propName, String(value));
            }
        }
    }
}

module.exports = new MigrationService();

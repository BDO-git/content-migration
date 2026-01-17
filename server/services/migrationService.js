const axios = require('axios');
const FormData = require('form-data'); // If we need to upload binaries, but for now json/props

class MigrationService {
    constructor(targetUrl, auth) {
        this.targetUrl = targetUrl.replace(/\/$/, ''); // remove trailing slash
        this.auth = auth; // { username: '', password: '' } (or service token)
        // Basic Auth
        this.authHeader = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    }

    async migrate(rootNode, dryRun = false) {
        const report = {
            success: [],
            errors: []
        };

        await this.traverseAndMigrate(rootNode, dryRun, report);
        return report;
    }

    async traverseAndMigrate(node, dryRun, report) {
        // Skip root node if it's just a holder
        if (node.path !== '/') {
            try {
                if (dryRun) {
                    // console.log(`[DryRun] Creating node: ${node.path} (${node.primaryType})`);
                    report.success.push(`[DryRun] Created ${node.path}`);
                } else {
                    await this.createNode(node);
                    report.success.push(`Created ${node.path}`);
                }
            } catch (error) {
                console.error(`Failed to migrate ${node.path}:`, error.message);
                report.errors.push(`Failed ${node.path}: ${error.message}`);
                // Stop processing children if parent fails? Or continue?
                // Usually continue best effort.
            }
        }

        if (node.children) {
            for (const child of node.children) {
                await this.traverseAndMigrate(child, dryRun, report);
            }
        }
    }

    async createNode(node) {
        // Prepare FormData or POST body
        // Sling Post Servlet: POST to path implies create/update
        const url = `${this.targetUrl}${node.path}`;

        const params = new URLSearchParams();

        // Add jcr:primaryType
        if (node.primaryType) {
            params.append('jcr:primaryType', node.primaryType);
        }

        // Add properties
        if (node.properties) {
            for (const [key, value] of Object.entries(node.properties)) {
                if (key.startsWith('xmlns:')) continue; // Skip xmlns
                if (key === 'jcr:primaryType') continue; // Already added

                // Handle arrays?
                if (Array.isArray(value)) {
                    value.forEach(v => params.append(key, v));
                    if (value.length > 1) {
                        params.append(`${key}@TypeHint`, 'String[]'); // Simplified Hint
                    }
                } else {
                    params.append(key, value);
                }
            }
        }

        // Send Request
        // In real AEM, creating a page requires creating the parent cq:Page first, then jcr:content.
        // Our tree traversal (via TreeService) should yield folders -> parents -> children.
        // TreeService uses pre-order traversal (parent inserted first if recursive logic holds).

        try {
            await axios.post(url, params, {
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
        } catch (error) {
            // If error is "node matches existing node", it might be an update.
            // Sling usually handles updates fine on POST.
            // If 404, maybe parent doesn't exist?
            if (error.response) {
                throw new Error(`API Error ${error.response.status}: ${error.response.statusText}`);
            }
            throw error;
        }
    }
}

module.exports = MigrationService;

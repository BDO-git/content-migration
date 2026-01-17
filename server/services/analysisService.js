const fs = require('fs');
const path = require('path');

class AnalysisService {
    constructor() { }

    /**
     * Traverses the tree (from TreeService) and aggregates usage stats.
     * @param {Object} rootNode - The root node of the JCR tree.
     * @returns {Object} Report containing templates and components found.
     */
    analyze(rootNode) {
        const report = {
            templates: new Set(),
            components: {} // Map<resourceType, { count: number, properties: Set<string> }>
        };

        this.traverse(rootNode, report);

        return this.formatReport(report);
    }

    traverse(node, report) {
        if (!node) return;

        // 1. Check for Template
        // Templates are usually defined on cq:PageContent nodes via cq:template property
        if (node.properties && node.properties['cq:template']) {
            report.templates.add(node.properties['cq:template']);
        }

        // 2. Check for Component
        // Components are identified by sling:resourceType
        if (node.properties && node.properties['sling:resourceType']) {
            const rt = node.properties['sling:resourceType'];

            // Initialize if new
            if (!report.components[rt]) {
                report.components[rt] = {
                    count: 0,
                    properties: new Set()
                };
            }

            // Increment count
            report.components[rt].count++;

            // Collect all property keys found on this component instance
            // We exclude standard JCR/Sling properties to reduce noise if desired, 
            // but for a full report, we include everything or filter common ones.
            // Let's filter common system properties to keep it clean.
            const systemPrefixes = ['jcr:', 'cq:', 'sling:', 'nt:', 'rep:'];

            Object.keys(node.properties).forEach(prop => {
                // simple filter: include if it DOESN'T start with system prefix, 
                // OR if it is specifically useful like jcr:title. 
                // For now, let's include everything but maybe flag them? 
                // User asked for "corresponding properties".

                // Let's just collect all keys for now. 
                // If we want to filter common ones like jcr:created, jcr:uuid we can.
                report.components[rt].properties.add(prop);
            });
        }

        // Recurse
        if (node.children && node.children.length > 0) {
            node.children.forEach(child => this.traverse(child, report));
        }
    }

    formatReport(report) {
        const formatted = {
            templates: Array.from(report.templates).sort(),
            components: []
        };

        // Convert components map to array
        Object.keys(report.components).sort().forEach(rt => {
            const data = report.components[rt];
            formatted.components.push({
                resourceType: rt,
                count: data.count,
                properties: Array.from(data.properties).sort()
            });
        });

        return formatted;
    }

    async generateMarkdownReport(analysisData, packageId, outputRootDir) {
        let md = `# Package Analysis Report\n\n`;
        md += `**Package ID:** ${packageId}\n`;
        md += `**Date:** ${new Date().toLocaleString()}\n\n`;

        md += `## Templates Found (${analysisData.templates.length})\n`;
        if (analysisData.templates.length === 0) {
            md += `_No templates found._\n`;
        } else {
            analysisData.templates.forEach(t => md += `- \`${t}\`\n`);
        }
        md += `\n`;

        md += `## Components Found (${analysisData.components.length})\n`;

        if (analysisData.components.length === 0) {
            md += `_No components found._\n`;
        } else {
            analysisData.components.forEach(comp => {
                md += `### ${comp.resourceType}\n`;
                md += `- **Usage Count:** ${comp.count}\n`;
                md += `- **Properties:**\n`;
                if (comp.properties.length === 0) {
                    md += `  - _No properties detected_\n`;
                } else {
                    comp.properties.forEach(p => md += `  - \`${p}\`\n`);
                }
                md += `\n`;
            });
        }

        const fileName = `analysis_report_${packageId}.md`;
        // Navigate up from server/services to workspace root (ag-wrokspace)
        // server/services -> server -> ag-wrokspace
        const outputPath = path.join(__dirname, '../../', fileName);

        await fs.promises.writeFile(outputPath, md, 'utf8');
        return outputPath;
    }

    async generateCSVReport(analysisData, packageId) {
        let csv = `Category,Item,UsageCount,Properties\n`;

        // Templates
        if (analysisData.templates.length > 0) {
            analysisData.templates.forEach(t => {
                csv += `Template,"${t}",,\n`;
            });
        }

        // Components
        if (analysisData.components.length > 0) {
            analysisData.components.forEach(comp => {
                // Escape quotes in properties if needed, though they shouldn't have any usually
                const props = comp.properties.join('; ');
                csv += `Component,"${comp.resourceType}",${comp.count},"${props}"\n`;
            });
        }

        const fileName = `analysis_report_${packageId}.csv`;
        const outputPath = path.join(__dirname, '../../', fileName);

        await fs.promises.writeFile(outputPath, csv, 'utf8');
        return outputPath;
    }
}

module.exports = AnalysisService;

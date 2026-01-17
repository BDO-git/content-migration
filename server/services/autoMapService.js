const fs = require('fs');
const path = require('path');

class AutoMapService {
    constructor() { }

    async generateMappings(templateListFile, componentListFile, analysisCsvFile) {
        // 1. Parse Input Files
        const sourceData = await this.parseAnalysisCSV(analysisCsvFile);
        const targetTemplates = await this.parseJSON(templateListFile); // { targetTemplates: [] }
        const targetComponents = await this.parseJSON(componentListFile); // { targetComponents: [] }

        // 2. Match Templates
        const templateMappings = this.matchTemplates(sourceData.templates, targetTemplates.targetTemplates);

        // 3. Match Components
        const componentMappings = this.matchComponents(sourceData.components, targetComponents.targetComponents);

        // 4. Generate Reports
        const reports = await this.generateReports(templateMappings, componentMappings);

        return {
            mappings: {
                templateMappings: templateMappings.map(m => m.mapping),
                componentMappings: componentMappings.map(m => m.mapping)
            },
            reports
        };
    }

    async parseAnalysisCSV(filePath) {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const templates = [];
        const components = [];

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV parse handling quotes
            // Format: Category,Item,UsageCount,Properties
            // Regex to match: (Category),("Item" or Item),(UsageCount),("Properties" or Properties)
            const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!parts) continue;

            // Clean quotes
            const clean = (s) => s ? s.replace(/^"|"$/g, '') : '';

            // Depending on how split works above, we might get fewer parts or complex logic.
            // Let's rely on standard split if no commas in values, but properties has semicolons inside quotes.
            // Re-doing simple parse logic for known structure:
            // Template,"/path/to/tpl",,
            // Component,"path/to/comp",10,"prop1; prop2"

            const category = line.split(',')[0];
            const firstQuote = line.indexOf('"');
            const secondQuote = line.indexOf('"', firstQuote + 1);

            // If quoted item
            let item = '';
            let remainder = '';

            if (firstQuote > -1 && firstQuote < 10) { // e.g. Component,"...
                item = line.substring(firstQuote + 1, secondQuote);
                remainder = line.substring(secondQuote + 2); // skip ",
            } else {
                const firstComma = line.indexOf(',');
                const secondComma = line.indexOf(',', firstComma + 1);
                item = line.substring(firstComma + 1, secondComma);
                remainder = line.substring(secondComma + 1);
            }

            if (category === 'Template') {
                templates.push(item);
            } else if (category === 'Component') {
                // Parse properties from remainder: usageCount,"props"
                const lastQuoteEnd = remainder.lastIndexOf('"');
                const lastQuoteStart = remainder.lastIndexOf('"', lastQuoteEnd - 1);

                let properties = [];
                if (lastQuoteStart > -1) {
                    const propsStr = remainder.substring(lastQuoteStart + 1, lastQuoteEnd);
                    properties = propsStr.split(';').map(p => p.trim());
                }

                components.push({
                    path: item,
                    properties: properties
                });
            }
        }

        return { templates, components };
    }

    async parseJSON(filePath) {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    }

    // --- Matching Logic ---

    matchTemplates(sourceTemplates, targetTemplates) {
        const results = [];

        sourceTemplates.forEach(source => {
            let bestMatch = null;
            let bestScore = -1;

            if (targetTemplates) {
                targetTemplates.forEach(target => {
                    // Score based on name similarity key
                    // target has targetTemplate1, targetTemplate2... dynamic keys?
                    // User format: { "targetTemplate1": "/path", "pageProperties": ... }
                    // We need to find the value that looks like a path
                    const targetPath = Object.values(target).find(v => typeof v === 'string' && v.startsWith('/'));

                    if (targetPath) {
                        const score = this.calculateScore(source, targetPath);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = targetPath;
                        }
                    }
                });
            }

            results.push({
                source: source,
                target: bestMatch || '',
                score: bestScore,
                mapping: {
                    sourceTemplate: source,
                    targetTemplate: bestMatch || '',
                    propertyMappings: {} // To assume defaults or empty
                }
            });
        });

        return results;
    }

    matchComponents(sourceComponents, targetComponents) {
        const results = [];

        sourceComponents.forEach(source => {
            let bestMatch = null;
            let bestScore = -1;
            let matchedTargetObj = null;

            if (targetComponents) {
                targetComponents.forEach(target => {
                    // User format: { "targetComponent": "path", "properties": {} }
                    const targetPath = target.targetComponent;

                    if (targetPath) {
                        // 1. Name Score
                        let score = this.calculateScore(source.path, targetPath);

                        // 2. Property Overlap Bonus
                        if (target.properties && source.properties) {
                            const targetProps = Object.keys(target.properties);
                            const overlap = source.properties.filter(p => targetProps.includes(p)).length;
                            score += (overlap * 5); // Boost for property match
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = targetPath;
                            matchedTargetObj = target;
                        }
                    }
                });
            }

            // Auto-map properties if match found
            const propMap = {};
            if (matchedTargetObj && matchedTargetObj.properties) {
                const targetProps = Object.keys(matchedTargetObj.properties);
                source.properties.forEach(sp => {
                    // Exact match?
                    if (targetProps.includes(sp)) {
                        propMap[sp] = sp;
                    }
                    // Fuzzy prop match could go here
                });
            }

            results.push({
                source: source.path,
                target: bestMatch || '',
                score: bestScore,
                mapping: {
                    sourceComponent: source.path,
                    targetComponent: bestMatch || '',
                    propertyMappings: propMap
                }
            });
        });

        return results;
    }

    calculateScore(str1, str2) {
        // Similarity score (0-100) based on simple token matching or Levenshtein
        // Using simplified token overlap for paths

        // Normalize
        const clean1 = path.basename(str1).toLowerCase();
        const clean2 = path.basename(str2).toLowerCase();

        if (clean1 === clean2) return 100;
        if (clean2.includes(clean1) || clean1.includes(clean2)) return 80;

        // Levenshtein-ish simple
        const distance = this.levenshtein(clean1, clean2);
        const maxLen = Math.max(clean1.length, clean2.length);
        if (maxLen === 0) return 0;

        return (1 - distance / maxLen) * 100;
    }

    levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    async generateReports(templateMappings, componentMappings) {
        // Generate CSVs

        // TPL Report
        let tplCsv = `Source Template,Best Match Target,Score\n`;
        templateMappings.forEach(m => {
            tplCsv += `"${m.source}","${m.target}",${m.score.toFixed(2)}\n`;
        });

        // Comp Report
        let compCsv = `Source Component,Best Match Target,Score,Mapped Properties\n`;
        componentMappings.forEach(m => {
            const props = Object.keys(m.mapping.propertyMappings).join(';');
            compCsv += `"${m.source}","${m.target}",${m.score.toFixed(2)},"${props}"\n`;
        });

        const rootDir = path.join(__dirname, '../../');
        const tplPath = path.join(rootDir, 'template_mapping_report.csv');
        const compPath = path.join(rootDir, 'component_mapping_report.csv');

        await fs.promises.writeFile(tplPath, tplCsv);
        await fs.promises.writeFile(compPath, compCsv);

        return {
            templateReport: tplPath,
            componentReport: compPath
        };
    }
}

module.exports = AutoMapService;

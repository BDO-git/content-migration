const fs = require('fs');
const path = require('path');

class AutoMapService {
    constructor() { }

    async generateMappings(targetDefinitionsFile, analysisCsvFile) {
        // 1. Parse Input Files
        const sourceData = await this.parseAnalysisCSV(analysisCsvFile);
        const targetData = await this.parseJSON(targetDefinitionsFile); // { templatelist: {...}, componentlist: {...} }

        // Extract lists from the new JSON structure
        // Extract lists from the new JSON structure, handling both casing styles
        const targetTemplates = (targetData.templatelist || targetData.templateList) ?
            (targetData.templatelist || targetData.templateList).targetTemplates : [];
        const targetComponents = (targetData.componentlist || targetData.componentList) ?
            (targetData.componentlist || targetData.componentList).targetComponents : [];

        // 2. Match Templates
        const templateMappings = this.matchTemplates(sourceData.templates, targetTemplates);

        // 3. Match Components
        const componentMappings = this.matchComponents(sourceData.components, targetComponents);

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

            const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!parts) continue;

            // Robust parsing
            const firstComma = line.indexOf(',');
            if (firstComma === -1) continue;

            const category = line.substring(0, firstComma);
            // Remainder after Category,
            const afterCategory = line.substring(firstComma + 1);

            let item = '';
            let remainder = '';

            if (afterCategory.trim().startsWith('"')) {
                // Item is quoted
                const openQuote = afterCategory.indexOf('"');
                const closeQuote = afterCategory.indexOf('"', openQuote + 1);
                if (closeQuote > -1) {
                    item = afterCategory.substring(openQuote + 1, closeQuote);
                    remainder = afterCategory.substring(closeQuote + 1); // ,Usage,"Props"
                }
            } else {
                // Item is not quoted
                const nextComma = afterCategory.indexOf(',');
                if (nextComma > -1) {
                    item = afterCategory.substring(0, nextComma);
                    remainder = afterCategory.substring(nextComma);
                } else {
                    // unexpected end of line?
                    item = afterCategory;
                }
            }

            if (category === 'Template') {
                templates.push(item);
            } else if (category === 'Component') {
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

    // Threshold for accepting a match
    matchThreshold = 60;

    matchTemplates(sourceTemplates, targetTemplates) {
        const results = [];

        sourceTemplates.forEach(source => {
            let bestMatch = null;
            let bestScore = -1;

            if (targetTemplates && Array.isArray(targetTemplates)) {
                targetTemplates.forEach(target => {
                    // target format: { "targetTemplate": "/path", "pageProperties": [...] }
                    const targetPath = target.targetTemplate;

                    if (targetPath) {
                        const score = this.calculateScore(source, targetPath);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = targetPath;
                        }
                    }
                });
            }

            // Apply threshold
            const finalMatch = (bestScore >= this.matchThreshold) ? bestMatch : 'no match found';

            results.push({
                source: source,
                target: finalMatch,
                score: bestScore,
                mapping: {
                    sourceTemplate: source,
                    targetTemplate: finalMatch === 'no match found' ? '' : finalMatch,
                    propertyMappings: {}
                }
            });
        });

        return results;
    }

    matchComponents(sourceComponents, targetComponents) {
        const results = [];

        sourceComponents.forEach(source => {
            // source is { path: "...", properties: [...] }
            let bestMatch = null;
            let bestScore = -1;
            let matchedTargetObj = null;

            if (targetComponents && Array.isArray(targetComponents)) {
                targetComponents.forEach(target => {
                    // target format: { "targetComponent": "path", "properties": [...] }
                    const targetPath = target.targetComponent;

                    if (targetPath) {
                        // 1. Name Score - prioritizing the component name (last part of path)
                        let score = this.calculateScore(source.path, targetPath);

                        // 2. Extra bonus for key component naming patterns (e.g., text, image, title)
                        const sourceName = path.basename(source.path).toLowerCase().replace(/"/g, '');
                        const targetName = path.basename(targetPath).toLowerCase();

                        if (sourceName === targetName) {
                            score += 20; // significant boost for exact name match
                        }

                        // 3. Property Overlap Bonus
                        // target properties is now an array of strings like ["jcr:title", ...]
                        if (target.properties && Array.isArray(target.properties) && source.properties) {
                            const overlap = source.properties.filter(p => target.properties.includes(p)).length;
                            // Small boost per property, capped
                            score += Math.min(overlap * 2, 20);
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = targetPath;
                            matchedTargetObj = target;
                        }
                    }
                });
            }

            // Apply Threshold
            const finalMatch = (bestScore >= this.matchThreshold) ? bestMatch : 'no match found';
            const finalTargetObj = (bestScore >= this.matchThreshold) ? matchedTargetObj : null;

            // Auto-map properties if match found
            let propMap = {};
            if (finalTargetObj && finalTargetObj.properties) {
                // Use fuzzy matching for properties
                propMap = this.matchProperties(source.properties, finalTargetObj.properties);
            }

            results.push({
                source: source.path,
                target: finalMatch,
                score: bestScore,
                mapping: {
                    sourceComponent: source.path,
                    targetComponent: finalMatch === 'no match found' ? '' : finalMatch,
                    propertyMappings: propMap
                }
            });
        });

        return results;
    }

    matchProperties(sourceProps, targetProps) {
        const mapping = {};

        sourceProps.forEach(sourceProp => {
            let bestPropMatch = null;
            let bestPropScore = -1;

            targetProps.forEach(targetProp => {
                let score = 0;

                // 1. Exact Match
                if (sourceProp === targetProp) {
                    score = 100;
                }
                // 2. Case-insensitive Match
                else if (sourceProp.toLowerCase() === targetProp.toLowerCase()) {
                    score = 90;
                }
                // 3. Contains Match (e.g. sitelogo -> logo)
                else if (sourceProp.toLowerCase().includes(targetProp.toLowerCase()) ||
                    targetProp.toLowerCase().includes(sourceProp.toLowerCase())) {
                    score = 70;
                }
                // 4. Levenshtein for typos
                else {
                    const distance = this.levenshtein(sourceProp.toLowerCase(), targetProp.toLowerCase());
                    const maxLen = Math.max(sourceProp.length, targetProp.length);
                    const fuzzyScore = (1 - distance / maxLen) * 60;
                    score = fuzzyScore;
                }

                if (score > bestPropScore) {
                    bestPropScore = score;
                    bestPropMatch = targetProp;
                }
            });

            // Threshold for property mapping (slightly looser than components to be helpful)
            if (bestPropScore >= 50) {
                mapping[sourceProp] = bestPropMatch;
            }
        });

        return mapping;
    }

    calculateScore(str1, str2) {
        // Similarity score (0-100)

        // Clean and normalize strings (remove quotes, lowercase)
        const clean1 = str1.replace(/"/g, '').toLowerCase();
        const clean2 = str2.replace(/"/g, '').toLowerCase();

        const base1 = path.basename(clean1);
        const base2 = path.basename(clean2);

        // 1. Exact Name Match (Highest Priority)
        if (base1 === base2) return 90;

        // 2. Contains Match
        if (base2.includes(base1) || base1.includes(base2)) return 70;

        // 3. Levenshtein Distance for close matches
        const distance = this.levenshtein(base1, base2);
        const maxLen = Math.max(base1.length, base2.length);
        if (maxLen === 0) return 0;

        // Return normalized score
        return (1 - distance / maxLen) * 60; // Max 60 for fuzzy match
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
            // Format props as "sourceProp=targetProp;source2=target2"
            const props = Object.entries(m.mapping.propertyMappings)
                .map(([source, target]) => `${source}=${target}`)
                .join(';');

            compCsv += `"${m.source}","${m.target}",${m.score.toFixed(2)},"${props}"\n`;
        });

        const rootDir = path.join(__dirname, '../../');
        const tplPath = path.join(rootDir, 'template_mapping_report.csv');
        const compPath = path.join(rootDir, 'component_mapping_report.csv');

        console.log(`Writing template report to: ${tplPath}`);
        console.log(`Writing component report to: ${compPath}`);
        await fs.promises.writeFile(tplPath, tplCsv);
        await fs.promises.writeFile(compPath, compCsv);
        console.log("Reports written successfully.");

        return {
            templateReport: tplPath,
            componentReport: compPath
        };
    }
}

module.exports = AutoMapService;

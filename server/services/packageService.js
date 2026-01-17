const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const sax = require('sax');

class PackageService {
    constructor(uploadDir, extractDir) {
        this.uploadDir = uploadDir;
        this.extractDir = extractDir;
    }

    async extractPackage(filePath, id) {
        const targetDir = path.join(this.extractDir, id);
        console.log(`[DEBUG] Extracting package...`);
        console.log(`[DEBUG] Source File: ${filePath}`);
        console.log(`[DEBUG] Target Dir: ${targetDir}`);

        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            if (!fs.existsSync(filePath)) {
                throw new Error(`Source file does not exist: ${filePath}`);
            }

            // Use adm-zip for consistent cross-platform extraction
            console.log(`[DEBUG] Extracting using adm-zip...`);
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(filePath);
            zip.extractAllTo(targetDir, true); // overwrite = true



            console.log(`[DEBUG] Extraction complete.`);

            // Verify something was actually extracted
            const extractedFiles = fs.readdirSync(targetDir);
            if (extractedFiles.length === 0) {
                throw new Error('Extraction produced no files. The zip might be empty or corrupted.');
            }
            console.log(`[DEBUG] Extracted ${extractedFiles.length} items to ${targetDir}`);

            const validation = await this.validatePackage(targetDir);

            return {
                id,
                path: targetDir,
                isValid: validation.isValid,
                roots: validation.roots
            };
        } catch (error) {
            console.error('Extraction error:', error);
            throw new Error(`Failed to extract package: ${error.message}`);
        }
    }

    async validatePackage(packagePath) {
        const filterPath = path.join(packagePath, 'META-INF', 'vault', 'filter.xml');
        const jcrRootPath = path.join(packagePath, 'jcr_root');

        if (!fs.existsSync(filterPath)) {
            throw new Error('Invalid package: META-INF/vault/filter.xml not found');
        }

        if (!fs.existsSync(jcrRootPath)) {
            throw new Error('Invalid package: jcr_root folder not found');
        }

        // Parse filter.xml to get roots
        const roots = await this.parseFilterXml(filterPath);
        return { isValid: true, roots };
    }

    parseFilterXml(xmlPath) {
        return new Promise((resolve, reject) => {
            const roots = [];
            const stream = fs.createReadStream(xmlPath, { encoding: 'utf8' });
            const parser = sax.createStream(true); // strict mode

            parser.on('opentag', (node) => {
                if (node.name === 'filter') {
                    if (node.attributes.root) {
                        roots.push(node.attributes.root);
                    }
                }
            });

            parser.on('error', (e) => {
                reject(e);
            });

            parser.on('end', () => {
                resolve(roots);
            });

            stream.pipe(parser);
        });
    }
}

module.exports = PackageService;

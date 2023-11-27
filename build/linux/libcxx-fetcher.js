/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Can be removed once https://github.com/electron/electron-rebuild/pull/703 is available.
import * as fs from 'fs';
import * as path from 'path';
import debug from 'debug';
import extract from 'extract-zip';
import { downloadArtifact } from '@electron/get';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = path.dirname(path.dirname(__dirname));
const d = debug('libcxx-fetcher');
export async function downloadLibcxxHeaders(outDir, electronVersion, lib_name) {
    if (await fs.existsSync(path.resolve(outDir, 'include'))) {
        return;
    }
    if (!await fs.existsSync(outDir)) {
        await fs.mkdirSync(outDir, { recursive: true });
    }
    d(`downloading ${lib_name}_headers`);
    const headers = await downloadArtifact({
        version: electronVersion,
        isGeneric: true,
        artifactName: `${lib_name}_headers.zip`,
    });
    d(`unpacking ${lib_name}_headers from ${headers}`);
    await extract(headers, { dir: outDir });
}
export async function downloadLibcxxObjects(outDir, electronVersion, targetArch = 'x64') {
    if (await fs.existsSync(path.resolve(outDir, 'libc++.a'))) {
        return;
    }
    if (!await fs.existsSync(outDir)) {
        await fs.mkdirSync(outDir, { recursive: true });
    }
    d(`downloading libcxx-objects-linux-${targetArch}`);
    const objects = await downloadArtifact({
        version: electronVersion,
        platform: 'linux',
        artifactName: 'libcxx-objects',
        arch: targetArch,
    });
    d(`unpacking libcxx-objects from ${objects}`);
    await extract(objects, { dir: outDir });
}
async function main() {
    const libcxxObjectsDirPath = process.env['VSCODE_LIBCXX_OBJECTS_DIR'];
    const libcxxHeadersDownloadDir = process.env['VSCODE_LIBCXX_HEADERS_DIR'];
    const libcxxabiHeadersDownloadDir = process.env['VSCODE_LIBCXXABI_HEADERS_DIR'];
    const arch = process.env['VSCODE_ARCH'];
    const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const electronVersion = packageJSON.devDependencies.electron;
    if (!libcxxObjectsDirPath || !libcxxHeadersDownloadDir || !libcxxabiHeadersDownloadDir) {
        throw new Error('Required build env not set');
    }
    await downloadLibcxxObjects(libcxxObjectsDirPath, electronVersion, arch);
    await downloadLibcxxHeaders(libcxxHeadersDownloadDir, electronVersion, 'libcxx');
    await downloadLibcxxHeaders(libcxxabiHeadersDownloadDir, electronVersion, 'libcxxabi');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=libcxx-fetcher.js.map
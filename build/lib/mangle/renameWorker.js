/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as ts from 'typescript';
import * as workerpool from 'workerpool';
import { StaticLanguageServiceHost } from './staticLanguageServiceHost';
let service; // = ts.createLanguageService(new StaticLanguageServiceHost(projectPath));
function findRenameLocations(projectPath, fileName, position) {
    if (!service) {
        service = ts.createLanguageService(new StaticLanguageServiceHost(projectPath));
    }
    return service.findRenameLocations(fileName, position, false, false, true) ?? [];
}
workerpool.worker({
    findRenameLocations
});
//# sourceMappingURL=renameWorker.js.map
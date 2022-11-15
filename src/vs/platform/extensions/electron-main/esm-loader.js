const path = require("node:path")


exports.resolve = (specifier, context, nextResolve) => {
	console.log({ specifier });
	if (specifier === "vscode") {
		const url = path.join(__dirname, "vscode.js");
		return nextResolve(url, context, nextResolve);
	}
	return nextResolve(specifier, context);
};

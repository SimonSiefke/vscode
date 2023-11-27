
declare module "gulp-filter" {
	import File from 'vinyl';
	import Minimatch from 'minimatch';

	declare namespace filter {
		interface FileFunction {
			(file: File): boolean;
		}

		interface Options extends Minimatch.IOptions {
			restore?: boolean;
			passthrough?: boolean;
		}

		// A transform stream with a .restore object
		interface Filter extends NodeJS.ReadWriteStream {
			restore: NodeJS.ReadWriteStream
		}
	}

	declare function filter(pattern: string | string[] | filter.FileFunction, options?: filter.Options): filter.Filter;

	export default filter;
}

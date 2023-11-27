
declare module "gulp-postcss" {
	import Vinyl from 'vinyl';

	interface Options {
		parser?: any;
	}

	declare function GulpPostCss(plugins?: any[], options?: Options): NodeJS.ReadWriteStream;
	declare function GulpPostCss(callback?: (file: Vinyl) => { plugins?: any[], options?: Options }):
		NodeJS.ReadWriteStream;


	export default GulpPostCss;
}

CREATE TABLE `cascade_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`root_table` text NOT NULL,
	`root_id` integer NOT NULL,
	`deletion_stamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cascade_jobs_job_key_unique` ON `cascade_jobs` (`job_key`);--> statement-breakpoint
CREATE TABLE `cascade_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`row_id` integer NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `cascade_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cascade_nodes_job_table_row_unique` ON `cascade_nodes` (`job_id`,`table_name`,`row_id`);--> statement-breakpoint
CREATE INDEX `cascade_nodes_pending_idx` ON `cascade_nodes` (`job_id`,`processed`,`id`);--> statement-breakpoint
CREATE TABLE `job_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`published_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_outbox_event_key_unique` ON `job_outbox` (`event_key`);--> statement-breakpoint
CREATE INDEX `job_outbox_pending_idx` ON `job_outbox` (`published_at`,`id`);--> statement-breakpoint
CREATE INDEX `job_outbox_completion_idx` ON `job_outbox` (`type`,`completed_at`,`id`);--> statement-breakpoint
CREATE TABLE `search_case_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character` text NOT NULL,
	`folded` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_case_mapping_character_unique` ON `search_case_mapping` (`character`);--> statement-breakpoint
CREATE TABLE `search_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_table` text NOT NULL,
	`row_id` integer NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_values_source_unique` ON `search_values` (`source_table`,`row_id`,`field`);--> statement-breakpoint
ALTER TABLE `issue_activities` ADD `mutation_id` text;--> statement-breakpoint
CREATE INDEX `issue_activities_mutation_id_idx` ON `issue_activities` (`mutation_id`);
--> statement-breakpoint
UPDATE `api_tokens` SET `is_active` = 0 WHERE `workspace_id` IS NULL;
--> statement-breakpoint
-- Seed Unicode lowercase mappings per code point to match foldCase in src/server/common/unicode.ts.
INSERT INTO search_case_mapping(character, folded) VALUES ('A','a'),('B','b'),('C','c'),('D','d'),('E','e'),('F','f'),('G','g'),('H','h'),('I','i'),('J','j'),('K','k'),('L','l'),('M','m'),('N','n'),('O','o'),('P','p'),('Q','q'),('R','r'),('S','s'),('T','t'),('U','u'),('V','v'),('W','w'),('X','x'),('Y','y'),('Z','z'),('À','à'),('Á','á'),('Â','â'),('Ã','ã'),('Ä','ä'),('Å','å'),('Æ','æ'),('Ç','ç'),('È','è'),('É','é'),('Ê','ê'),('Ë','ë'),('Ì','ì'),('Í','í'),('Î','î'),('Ï','ï'),('Ð','ð'),('Ñ','ñ'),('Ò','ò'),('Ó','ó'),('Ô','ô'),('Õ','õ'),('Ö','ö'),('Ø','ø'),('Ù','ù'),('Ú','ú'),('Û','û'),('Ü','ü'),('Ý','ý'),('Þ','þ'),('Ā','ā'),('Ă','ă'),('Ą','ą'),('Ć','ć'),('Ĉ','ĉ'),('Ċ','ċ'),('Č','č'),('Ď','ď'),('Đ','đ'),('Ē','ē'),('Ĕ','ĕ'),('Ė','ė'),('Ę','ę'),('Ě','ě'),('Ĝ','ĝ'),('Ğ','ğ'),('Ġ','ġ'),('Ģ','ģ'),('Ĥ','ĥ'),('Ħ','ħ'),('Ĩ','ĩ'),('Ī','ī'),('Ĭ','ĭ'),('Į','į'),('İ','i̇'),('Ĳ','ĳ'),('Ĵ','ĵ'),('Ķ','ķ'),('Ĺ','ĺ'),('Ļ','ļ'),('Ľ','ľ'),('Ŀ','ŀ'),('Ł','ł'),('Ń','ń'),('Ņ','ņ'),('Ň','ň'),('Ŋ','ŋ'),('Ō','ō'),('Ŏ','ŏ'),('Ő','ő'),('Œ','œ'),('Ŕ','ŕ'),('Ŗ','ŗ'),('Ř','ř');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ś','ś'),('Ŝ','ŝ'),('Ş','ş'),('Š','š'),('Ţ','ţ'),('Ť','ť'),('Ŧ','ŧ'),('Ũ','ũ'),('Ū','ū'),('Ŭ','ŭ'),('Ů','ů'),('Ű','ű'),('Ų','ų'),('Ŵ','ŵ'),('Ŷ','ŷ'),('Ÿ','ÿ'),('Ź','ź'),('Ż','ż'),('Ž','ž'),('Ɓ','ɓ'),('Ƃ','ƃ'),('Ƅ','ƅ'),('Ɔ','ɔ'),('Ƈ','ƈ'),('Ɖ','ɖ'),('Ɗ','ɗ'),('Ƌ','ƌ'),('Ǝ','ǝ'),('Ə','ə'),('Ɛ','ɛ'),('Ƒ','ƒ'),('Ɠ','ɠ'),('Ɣ','ɣ'),('Ɩ','ɩ'),('Ɨ','ɨ'),('Ƙ','ƙ'),('Ɯ','ɯ'),('Ɲ','ɲ'),('Ɵ','ɵ'),('Ơ','ơ'),('Ƣ','ƣ'),('Ƥ','ƥ'),('Ʀ','ʀ'),('Ƨ','ƨ'),('Ʃ','ʃ'),('Ƭ','ƭ'),('Ʈ','ʈ'),('Ư','ư'),('Ʊ','ʊ'),('Ʋ','ʋ'),('Ƴ','ƴ'),('Ƶ','ƶ'),('Ʒ','ʒ'),('Ƹ','ƹ'),('Ƽ','ƽ'),('Ǆ','ǆ'),('ǅ','ǆ'),('Ǉ','ǉ'),('ǈ','ǉ'),('Ǌ','ǌ'),('ǋ','ǌ'),('Ǎ','ǎ'),('Ǐ','ǐ'),('Ǒ','ǒ'),('Ǔ','ǔ'),('Ǖ','ǖ'),('Ǘ','ǘ'),('Ǚ','ǚ'),('Ǜ','ǜ'),('Ǟ','ǟ'),('Ǡ','ǡ'),('Ǣ','ǣ'),('Ǥ','ǥ'),('Ǧ','ǧ'),('Ǩ','ǩ'),('Ǫ','ǫ'),('Ǭ','ǭ'),('Ǯ','ǯ'),('Ǳ','ǳ'),('ǲ','ǳ'),('Ǵ','ǵ'),('Ƕ','ƕ'),('Ƿ','ƿ'),('Ǹ','ǹ'),('Ǻ','ǻ'),('Ǽ','ǽ'),('Ǿ','ǿ'),('Ȁ','ȁ'),('Ȃ','ȃ'),('Ȅ','ȅ'),('Ȇ','ȇ'),('Ȉ','ȉ'),('Ȋ','ȋ'),('Ȍ','ȍ'),('Ȏ','ȏ'),('Ȑ','ȑ'),('Ȓ','ȓ'),('Ȕ','ȕ'),('Ȗ','ȗ'),('Ș','ș');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ț','ț'),('Ȝ','ȝ'),('Ȟ','ȟ'),('Ƞ','ƞ'),('Ȣ','ȣ'),('Ȥ','ȥ'),('Ȧ','ȧ'),('Ȩ','ȩ'),('Ȫ','ȫ'),('Ȭ','ȭ'),('Ȯ','ȯ'),('Ȱ','ȱ'),('Ȳ','ȳ'),('Ⱥ','ⱥ'),('Ȼ','ȼ'),('Ƚ','ƚ'),('Ⱦ','ⱦ'),('Ɂ','ɂ'),('Ƀ','ƀ'),('Ʉ','ʉ'),('Ʌ','ʌ'),('Ɇ','ɇ'),('Ɉ','ɉ'),('Ɋ','ɋ'),('Ɍ','ɍ'),('Ɏ','ɏ'),('Ͱ','ͱ'),('Ͳ','ͳ'),('Ͷ','ͷ'),('Ϳ','ϳ'),('Ά','ά'),('Έ','έ'),('Ή','ή'),('Ί','ί'),('Ό','ό'),('Ύ','ύ'),('Ώ','ώ'),('Α','α'),('Β','β'),('Γ','γ'),('Δ','δ'),('Ε','ε'),('Ζ','ζ'),('Η','η'),('Θ','θ'),('Ι','ι'),('Κ','κ'),('Λ','λ'),('Μ','μ'),('Ν','ν'),('Ξ','ξ'),('Ο','ο'),('Π','π'),('Ρ','ρ'),('Σ','σ'),('Τ','τ'),('Υ','υ'),('Φ','φ'),('Χ','χ'),('Ψ','ψ'),('Ω','ω'),('Ϊ','ϊ'),('Ϋ','ϋ'),('Ϗ','ϗ'),('Ϙ','ϙ'),('Ϛ','ϛ'),('Ϝ','ϝ'),('Ϟ','ϟ'),('Ϡ','ϡ'),('Ϣ','ϣ'),('Ϥ','ϥ'),('Ϧ','ϧ'),('Ϩ','ϩ'),('Ϫ','ϫ'),('Ϭ','ϭ'),('Ϯ','ϯ'),('ϴ','θ'),('Ϸ','ϸ'),('Ϲ','ϲ'),('Ϻ','ϻ'),('Ͻ','ͻ'),('Ͼ','ͼ'),('Ͽ','ͽ'),('Ѐ','ѐ'),('Ё','ё'),('Ђ','ђ'),('Ѓ','ѓ'),('Є','є'),('Ѕ','ѕ'),('І','і'),('Ї','ї'),('Ј','ј'),('Љ','љ'),('Њ','њ'),('Ћ','ћ'),('Ќ','ќ'),('Ѝ','ѝ'),('Ў','ў'),('Џ','џ'),('А','а');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Б','б'),('В','в'),('Г','г'),('Д','д'),('Е','е'),('Ж','ж'),('З','з'),('И','и'),('Й','й'),('К','к'),('Л','л'),('М','м'),('Н','н'),('О','о'),('П','п'),('Р','р'),('С','с'),('Т','т'),('У','у'),('Ф','ф'),('Х','х'),('Ц','ц'),('Ч','ч'),('Ш','ш'),('Щ','щ'),('Ъ','ъ'),('Ы','ы'),('Ь','ь'),('Э','э'),('Ю','ю'),('Я','я'),('Ѡ','ѡ'),('Ѣ','ѣ'),('Ѥ','ѥ'),('Ѧ','ѧ'),('Ѩ','ѩ'),('Ѫ','ѫ'),('Ѭ','ѭ'),('Ѯ','ѯ'),('Ѱ','ѱ'),('Ѳ','ѳ'),('Ѵ','ѵ'),('Ѷ','ѷ'),('Ѹ','ѹ'),('Ѻ','ѻ'),('Ѽ','ѽ'),('Ѿ','ѿ'),('Ҁ','ҁ'),('Ҋ','ҋ'),('Ҍ','ҍ'),('Ҏ','ҏ'),('Ґ','ґ'),('Ғ','ғ'),('Ҕ','ҕ'),('Җ','җ'),('Ҙ','ҙ'),('Қ','қ'),('Ҝ','ҝ'),('Ҟ','ҟ'),('Ҡ','ҡ'),('Ң','ң'),('Ҥ','ҥ'),('Ҧ','ҧ'),('Ҩ','ҩ'),('Ҫ','ҫ'),('Ҭ','ҭ'),('Ү','ү'),('Ұ','ұ'),('Ҳ','ҳ'),('Ҵ','ҵ'),('Ҷ','ҷ'),('Ҹ','ҹ'),('Һ','һ'),('Ҽ','ҽ'),('Ҿ','ҿ'),('Ӏ','ӏ'),('Ӂ','ӂ'),('Ӄ','ӄ'),('Ӆ','ӆ'),('Ӈ','ӈ'),('Ӊ','ӊ'),('Ӌ','ӌ'),('Ӎ','ӎ'),('Ӑ','ӑ'),('Ӓ','ӓ'),('Ӕ','ӕ'),('Ӗ','ӗ'),('Ә','ә'),('Ӛ','ӛ'),('Ӝ','ӝ'),('Ӟ','ӟ'),('Ӡ','ӡ'),('Ӣ','ӣ'),('Ӥ','ӥ'),('Ӧ','ӧ'),('Ө','ө'),('Ӫ','ӫ'),('Ӭ','ӭ'),('Ӯ','ӯ'),('Ӱ','ӱ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ӳ','ӳ'),('Ӵ','ӵ'),('Ӷ','ӷ'),('Ӹ','ӹ'),('Ӻ','ӻ'),('Ӽ','ӽ'),('Ӿ','ӿ'),('Ԁ','ԁ'),('Ԃ','ԃ'),('Ԅ','ԅ'),('Ԇ','ԇ'),('Ԉ','ԉ'),('Ԋ','ԋ'),('Ԍ','ԍ'),('Ԏ','ԏ'),('Ԑ','ԑ'),('Ԓ','ԓ'),('Ԕ','ԕ'),('Ԗ','ԗ'),('Ԙ','ԙ'),('Ԛ','ԛ'),('Ԝ','ԝ'),('Ԟ','ԟ'),('Ԡ','ԡ'),('Ԣ','ԣ'),('Ԥ','ԥ'),('Ԧ','ԧ'),('Ԩ','ԩ'),('Ԫ','ԫ'),('Ԭ','ԭ'),('Ԯ','ԯ'),('Ա','ա'),('Բ','բ'),('Գ','գ'),('Դ','դ'),('Ե','ե'),('Զ','զ'),('Է','է'),('Ը','ը'),('Թ','թ'),('Ժ','ժ'),('Ի','ի'),('Լ','լ'),('Խ','խ'),('Ծ','ծ'),('Կ','կ'),('Հ','հ'),('Ձ','ձ'),('Ղ','ղ'),('Ճ','ճ'),('Մ','մ'),('Յ','յ'),('Ն','ն'),('Շ','շ'),('Ո','ո'),('Չ','չ'),('Պ','պ'),('Ջ','ջ'),('Ռ','ռ'),('Ս','ս'),('Վ','վ'),('Տ','տ'),('Ր','ր'),('Ց','ց'),('Ւ','ւ'),('Փ','փ'),('Ք','ք'),('Օ','օ'),('Ֆ','ֆ'),('Ⴀ','ⴀ'),('Ⴁ','ⴁ'),('Ⴂ','ⴂ'),('Ⴃ','ⴃ'),('Ⴄ','ⴄ'),('Ⴅ','ⴅ'),('Ⴆ','ⴆ'),('Ⴇ','ⴇ'),('Ⴈ','ⴈ'),('Ⴉ','ⴉ'),('Ⴊ','ⴊ'),('Ⴋ','ⴋ'),('Ⴌ','ⴌ'),('Ⴍ','ⴍ'),('Ⴎ','ⴎ'),('Ⴏ','ⴏ'),('Ⴐ','ⴐ'),('Ⴑ','ⴑ'),('Ⴒ','ⴒ'),('Ⴓ','ⴓ'),('Ⴔ','ⴔ'),('Ⴕ','ⴕ'),('Ⴖ','ⴖ'),('Ⴗ','ⴗ'),('Ⴘ','ⴘ'),('Ⴙ','ⴙ'),('Ⴚ','ⴚ'),('Ⴛ','ⴛ'),('Ⴜ','ⴜ'),('Ⴝ','ⴝ'),('Ⴞ','ⴞ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ⴟ','ⴟ'),('Ⴠ','ⴠ'),('Ⴡ','ⴡ'),('Ⴢ','ⴢ'),('Ⴣ','ⴣ'),('Ⴤ','ⴤ'),('Ⴥ','ⴥ'),('Ⴧ','ⴧ'),('Ⴭ','ⴭ'),('Ꭰ','ꭰ'),('Ꭱ','ꭱ'),('Ꭲ','ꭲ'),('Ꭳ','ꭳ'),('Ꭴ','ꭴ'),('Ꭵ','ꭵ'),('Ꭶ','ꭶ'),('Ꭷ','ꭷ'),('Ꭸ','ꭸ'),('Ꭹ','ꭹ'),('Ꭺ','ꭺ'),('Ꭻ','ꭻ'),('Ꭼ','ꭼ'),('Ꭽ','ꭽ'),('Ꭾ','ꭾ'),('Ꭿ','ꭿ'),('Ꮀ','ꮀ'),('Ꮁ','ꮁ'),('Ꮂ','ꮂ'),('Ꮃ','ꮃ'),('Ꮄ','ꮄ'),('Ꮅ','ꮅ'),('Ꮆ','ꮆ'),('Ꮇ','ꮇ'),('Ꮈ','ꮈ'),('Ꮉ','ꮉ'),('Ꮊ','ꮊ'),('Ꮋ','ꮋ'),('Ꮌ','ꮌ'),('Ꮍ','ꮍ'),('Ꮎ','ꮎ'),('Ꮏ','ꮏ'),('Ꮐ','ꮐ'),('Ꮑ','ꮑ'),('Ꮒ','ꮒ'),('Ꮓ','ꮓ'),('Ꮔ','ꮔ'),('Ꮕ','ꮕ'),('Ꮖ','ꮖ'),('Ꮗ','ꮗ'),('Ꮘ','ꮘ'),('Ꮙ','ꮙ'),('Ꮚ','ꮚ'),('Ꮛ','ꮛ'),('Ꮜ','ꮜ'),('Ꮝ','ꮝ'),('Ꮞ','ꮞ'),('Ꮟ','ꮟ'),('Ꮠ','ꮠ'),('Ꮡ','ꮡ'),('Ꮢ','ꮢ'),('Ꮣ','ꮣ'),('Ꮤ','ꮤ'),('Ꮥ','ꮥ'),('Ꮦ','ꮦ'),('Ꮧ','ꮧ'),('Ꮨ','ꮨ'),('Ꮩ','ꮩ'),('Ꮪ','ꮪ'),('Ꮫ','ꮫ'),('Ꮬ','ꮬ'),('Ꮭ','ꮭ'),('Ꮮ','ꮮ'),('Ꮯ','ꮯ'),('Ꮰ','ꮰ'),('Ꮱ','ꮱ'),('Ꮲ','ꮲ'),('Ꮳ','ꮳ'),('Ꮴ','ꮴ'),('Ꮵ','ꮵ'),('Ꮶ','ꮶ'),('Ꮷ','ꮷ'),('Ꮸ','ꮸ'),('Ꮹ','ꮹ'),('Ꮺ','ꮺ'),('Ꮻ','ꮻ'),('Ꮼ','ꮼ'),('Ꮽ','ꮽ'),('Ꮾ','ꮾ'),('Ꮿ','ꮿ'),('Ᏸ','ᏸ'),('Ᏹ','ᏹ'),('Ᏺ','ᏺ'),('Ᏻ','ᏻ'),('Ᏼ','ᏼ'),('Ᏽ','ᏽ'),('Ᲊ','ᲊ'),('Ა','ა'),('Ბ','ბ'),('Გ','გ'),('Დ','დ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ე','ე'),('Ვ','ვ'),('Ზ','ზ'),('Თ','თ'),('Ი','ი'),('Კ','კ'),('Ლ','ლ'),('Მ','მ'),('Ნ','ნ'),('Ო','ო'),('Პ','პ'),('Ჟ','ჟ'),('Რ','რ'),('Ს','ს'),('Ტ','ტ'),('Უ','უ'),('Ფ','ფ'),('Ქ','ქ'),('Ღ','ღ'),('Ყ','ყ'),('Შ','შ'),('Ჩ','ჩ'),('Ც','ც'),('Ძ','ძ'),('Წ','წ'),('Ჭ','ჭ'),('Ხ','ხ'),('Ჯ','ჯ'),('Ჰ','ჰ'),('Ჱ','ჱ'),('Ჲ','ჲ'),('Ჳ','ჳ'),('Ჴ','ჴ'),('Ჵ','ჵ'),('Ჶ','ჶ'),('Ჷ','ჷ'),('Ჸ','ჸ'),('Ჹ','ჹ'),('Ჺ','ჺ'),('Ჽ','ჽ'),('Ჾ','ჾ'),('Ჿ','ჿ'),('Ḁ','ḁ'),('Ḃ','ḃ'),('Ḅ','ḅ'),('Ḇ','ḇ'),('Ḉ','ḉ'),('Ḋ','ḋ'),('Ḍ','ḍ'),('Ḏ','ḏ'),('Ḑ','ḑ'),('Ḓ','ḓ'),('Ḕ','ḕ'),('Ḗ','ḗ'),('Ḙ','ḙ'),('Ḛ','ḛ'),('Ḝ','ḝ'),('Ḟ','ḟ'),('Ḡ','ḡ'),('Ḣ','ḣ'),('Ḥ','ḥ'),('Ḧ','ḧ'),('Ḩ','ḩ'),('Ḫ','ḫ'),('Ḭ','ḭ'),('Ḯ','ḯ'),('Ḱ','ḱ'),('Ḳ','ḳ'),('Ḵ','ḵ'),('Ḷ','ḷ'),('Ḹ','ḹ'),('Ḻ','ḻ'),('Ḽ','ḽ'),('Ḿ','ḿ'),('Ṁ','ṁ'),('Ṃ','ṃ'),('Ṅ','ṅ'),('Ṇ','ṇ'),('Ṉ','ṉ'),('Ṋ','ṋ'),('Ṍ','ṍ'),('Ṏ','ṏ'),('Ṑ','ṑ'),('Ṓ','ṓ'),('Ṕ','ṕ'),('Ṗ','ṗ'),('Ṙ','ṙ'),('Ṛ','ṛ'),('Ṝ','ṝ'),('Ṟ','ṟ'),('Ṡ','ṡ'),('Ṣ','ṣ'),('Ṥ','ṥ'),('Ṧ','ṧ'),('Ṩ','ṩ'),('Ṫ','ṫ'),('Ṭ','ṭ'),('Ṯ','ṯ'),('Ṱ','ṱ'),('Ṳ','ṳ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ṵ','ṵ'),('Ṷ','ṷ'),('Ṹ','ṹ'),('Ṻ','ṻ'),('Ṽ','ṽ'),('Ṿ','ṿ'),('Ẁ','ẁ'),('Ẃ','ẃ'),('Ẅ','ẅ'),('Ẇ','ẇ'),('Ẉ','ẉ'),('Ẋ','ẋ'),('Ẍ','ẍ'),('Ẏ','ẏ'),('Ẑ','ẑ'),('Ẓ','ẓ'),('Ẕ','ẕ'),('ẞ','ß'),('Ạ','ạ'),('Ả','ả'),('Ấ','ấ'),('Ầ','ầ'),('Ẩ','ẩ'),('Ẫ','ẫ'),('Ậ','ậ'),('Ắ','ắ'),('Ằ','ằ'),('Ẳ','ẳ'),('Ẵ','ẵ'),('Ặ','ặ'),('Ẹ','ẹ'),('Ẻ','ẻ'),('Ẽ','ẽ'),('Ế','ế'),('Ề','ề'),('Ể','ể'),('Ễ','ễ'),('Ệ','ệ'),('Ỉ','ỉ'),('Ị','ị'),('Ọ','ọ'),('Ỏ','ỏ'),('Ố','ố'),('Ồ','ồ'),('Ổ','ổ'),('Ỗ','ỗ'),('Ộ','ộ'),('Ớ','ớ'),('Ờ','ờ'),('Ở','ở'),('Ỡ','ỡ'),('Ợ','ợ'),('Ụ','ụ'),('Ủ','ủ'),('Ứ','ứ'),('Ừ','ừ'),('Ử','ử'),('Ữ','ữ'),('Ự','ự'),('Ỳ','ỳ'),('Ỵ','ỵ'),('Ỷ','ỷ'),('Ỹ','ỹ'),('Ỻ','ỻ'),('Ỽ','ỽ'),('Ỿ','ỿ'),('Ἀ','ἀ'),('Ἁ','ἁ'),('Ἂ','ἂ'),('Ἃ','ἃ'),('Ἄ','ἄ'),('Ἅ','ἅ'),('Ἆ','ἆ'),('Ἇ','ἇ'),('Ἐ','ἐ'),('Ἑ','ἑ'),('Ἒ','ἒ'),('Ἓ','ἓ'),('Ἔ','ἔ'),('Ἕ','ἕ'),('Ἠ','ἠ'),('Ἡ','ἡ'),('Ἢ','ἢ'),('Ἣ','ἣ'),('Ἤ','ἤ'),('Ἥ','ἥ'),('Ἦ','ἦ'),('Ἧ','ἧ'),('Ἰ','ἰ'),('Ἱ','ἱ'),('Ἲ','ἲ'),('Ἳ','ἳ'),('Ἴ','ἴ'),('Ἵ','ἵ'),('Ἶ','ἶ'),('Ἷ','ἷ'),('Ὀ','ὀ'),('Ὁ','ὁ'),('Ὂ','ὂ'),('Ὃ','ὃ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ὄ','ὄ'),('Ὅ','ὅ'),('Ὑ','ὑ'),('Ὓ','ὓ'),('Ὕ','ὕ'),('Ὗ','ὗ'),('Ὠ','ὠ'),('Ὡ','ὡ'),('Ὢ','ὢ'),('Ὣ','ὣ'),('Ὤ','ὤ'),('Ὥ','ὥ'),('Ὦ','ὦ'),('Ὧ','ὧ'),('ᾈ','ᾀ'),('ᾉ','ᾁ'),('ᾊ','ᾂ'),('ᾋ','ᾃ'),('ᾌ','ᾄ'),('ᾍ','ᾅ'),('ᾎ','ᾆ'),('ᾏ','ᾇ'),('ᾘ','ᾐ'),('ᾙ','ᾑ'),('ᾚ','ᾒ'),('ᾛ','ᾓ'),('ᾜ','ᾔ'),('ᾝ','ᾕ'),('ᾞ','ᾖ'),('ᾟ','ᾗ'),('ᾨ','ᾠ'),('ᾩ','ᾡ'),('ᾪ','ᾢ'),('ᾫ','ᾣ'),('ᾬ','ᾤ'),('ᾭ','ᾥ'),('ᾮ','ᾦ'),('ᾯ','ᾧ'),('Ᾰ','ᾰ'),('Ᾱ','ᾱ'),('Ὰ','ὰ'),('Ά','ά'),('ᾼ','ᾳ'),('Ὲ','ὲ'),('Έ','έ'),('Ὴ','ὴ'),('Ή','ή'),('ῌ','ῃ'),('Ῐ','ῐ'),('Ῑ','ῑ'),('Ὶ','ὶ'),('Ί','ί'),('Ῠ','ῠ'),('Ῡ','ῡ'),('Ὺ','ὺ'),('Ύ','ύ'),('Ῥ','ῥ'),('Ὸ','ὸ'),('Ό','ό'),('Ὼ','ὼ'),('Ώ','ώ'),('ῼ','ῳ'),('Ω','ω'),('K','k'),('Å','å'),('Ⅎ','ⅎ'),('Ⅰ','ⅰ'),('Ⅱ','ⅱ'),('Ⅲ','ⅲ'),('Ⅳ','ⅳ'),('Ⅴ','ⅴ'),('Ⅵ','ⅵ'),('Ⅶ','ⅶ'),('Ⅷ','ⅷ'),('Ⅸ','ⅸ'),('Ⅹ','ⅹ'),('Ⅺ','ⅺ'),('Ⅻ','ⅻ'),('Ⅼ','ⅼ'),('Ⅽ','ⅽ'),('Ⅾ','ⅾ'),('Ⅿ','ⅿ'),('Ↄ','ↄ'),('Ⓐ','ⓐ'),('Ⓑ','ⓑ'),('Ⓒ','ⓒ'),('Ⓓ','ⓓ'),('Ⓔ','ⓔ'),('Ⓕ','ⓕ'),('Ⓖ','ⓖ'),('Ⓗ','ⓗ'),('Ⓘ','ⓘ'),('Ⓙ','ⓙ'),('Ⓚ','ⓚ'),('Ⓛ','ⓛ'),('Ⓜ','ⓜ'),('Ⓝ','ⓝ'),('Ⓞ','ⓞ'),('Ⓟ','ⓟ'),('Ⓠ','ⓠ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ⓡ','ⓡ'),('Ⓢ','ⓢ'),('Ⓣ','ⓣ'),('Ⓤ','ⓤ'),('Ⓥ','ⓥ'),('Ⓦ','ⓦ'),('Ⓧ','ⓧ'),('Ⓨ','ⓨ'),('Ⓩ','ⓩ'),('Ⰰ','ⰰ'),('Ⰱ','ⰱ'),('Ⰲ','ⰲ'),('Ⰳ','ⰳ'),('Ⰴ','ⰴ'),('Ⰵ','ⰵ'),('Ⰶ','ⰶ'),('Ⰷ','ⰷ'),('Ⰸ','ⰸ'),('Ⰹ','ⰹ'),('Ⰺ','ⰺ'),('Ⰻ','ⰻ'),('Ⰼ','ⰼ'),('Ⰽ','ⰽ'),('Ⰾ','ⰾ'),('Ⰿ','ⰿ'),('Ⱀ','ⱀ'),('Ⱁ','ⱁ'),('Ⱂ','ⱂ'),('Ⱃ','ⱃ'),('Ⱄ','ⱄ'),('Ⱅ','ⱅ'),('Ⱆ','ⱆ'),('Ⱇ','ⱇ'),('Ⱈ','ⱈ'),('Ⱉ','ⱉ'),('Ⱊ','ⱊ'),('Ⱋ','ⱋ'),('Ⱌ','ⱌ'),('Ⱍ','ⱍ'),('Ⱎ','ⱎ'),('Ⱏ','ⱏ'),('Ⱐ','ⱐ'),('Ⱑ','ⱑ'),('Ⱒ','ⱒ'),('Ⱓ','ⱓ'),('Ⱔ','ⱔ'),('Ⱕ','ⱕ'),('Ⱖ','ⱖ'),('Ⱗ','ⱗ'),('Ⱘ','ⱘ'),('Ⱙ','ⱙ'),('Ⱚ','ⱚ'),('Ⱛ','ⱛ'),('Ⱜ','ⱜ'),('Ⱝ','ⱝ'),('Ⱞ','ⱞ'),('Ⱟ','ⱟ'),('Ⱡ','ⱡ'),('Ɫ','ɫ'),('Ᵽ','ᵽ'),('Ɽ','ɽ'),('Ⱨ','ⱨ'),('Ⱪ','ⱪ'),('Ⱬ','ⱬ'),('Ɑ','ɑ'),('Ɱ','ɱ'),('Ɐ','ɐ'),('Ɒ','ɒ'),('Ⱳ','ⱳ'),('Ⱶ','ⱶ'),('Ȿ','ȿ'),('Ɀ','ɀ'),('Ⲁ','ⲁ'),('Ⲃ','ⲃ'),('Ⲅ','ⲅ'),('Ⲇ','ⲇ'),('Ⲉ','ⲉ'),('Ⲋ','ⲋ'),('Ⲍ','ⲍ'),('Ⲏ','ⲏ'),('Ⲑ','ⲑ'),('Ⲓ','ⲓ'),('Ⲕ','ⲕ'),('Ⲗ','ⲗ'),('Ⲙ','ⲙ'),('Ⲛ','ⲛ'),('Ⲝ','ⲝ'),('Ⲟ','ⲟ'),('Ⲡ','ⲡ'),('Ⲣ','ⲣ'),('Ⲥ','ⲥ'),('Ⲧ','ⲧ'),('Ⲩ','ⲩ'),('Ⲫ','ⲫ'),('Ⲭ','ⲭ'),('Ⲯ','ⲯ'),('Ⲱ','ⲱ'),('Ⲳ','ⲳ'),('Ⲵ','ⲵ'),('Ⲷ','ⲷ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ⲹ','ⲹ'),('Ⲻ','ⲻ'),('Ⲽ','ⲽ'),('Ⲿ','ⲿ'),('Ⳁ','ⳁ'),('Ⳃ','ⳃ'),('Ⳅ','ⳅ'),('Ⳇ','ⳇ'),('Ⳉ','ⳉ'),('Ⳋ','ⳋ'),('Ⳍ','ⳍ'),('Ⳏ','ⳏ'),('Ⳑ','ⳑ'),('Ⳓ','ⳓ'),('Ⳕ','ⳕ'),('Ⳗ','ⳗ'),('Ⳙ','ⳙ'),('Ⳛ','ⳛ'),('Ⳝ','ⳝ'),('Ⳟ','ⳟ'),('Ⳡ','ⳡ'),('Ⳣ','ⳣ'),('Ⳬ','ⳬ'),('Ⳮ','ⳮ'),('Ⳳ','ⳳ'),('Ꙁ','ꙁ'),('Ꙃ','ꙃ'),('Ꙅ','ꙅ'),('Ꙇ','ꙇ'),('Ꙉ','ꙉ'),('Ꙋ','ꙋ'),('Ꙍ','ꙍ'),('Ꙏ','ꙏ'),('Ꙑ','ꙑ'),('Ꙓ','ꙓ'),('Ꙕ','ꙕ'),('Ꙗ','ꙗ'),('Ꙙ','ꙙ'),('Ꙛ','ꙛ'),('Ꙝ','ꙝ'),('Ꙟ','ꙟ'),('Ꙡ','ꙡ'),('Ꙣ','ꙣ'),('Ꙥ','ꙥ'),('Ꙧ','ꙧ'),('Ꙩ','ꙩ'),('Ꙫ','ꙫ'),('Ꙭ','ꙭ'),('Ꚁ','ꚁ'),('Ꚃ','ꚃ'),('Ꚅ','ꚅ'),('Ꚇ','ꚇ'),('Ꚉ','ꚉ'),('Ꚋ','ꚋ'),('Ꚍ','ꚍ'),('Ꚏ','ꚏ'),('Ꚑ','ꚑ'),('Ꚓ','ꚓ'),('Ꚕ','ꚕ'),('Ꚗ','ꚗ'),('Ꚙ','ꚙ'),('Ꚛ','ꚛ'),('Ꜣ','ꜣ'),('Ꜥ','ꜥ'),('Ꜧ','ꜧ'),('Ꜩ','ꜩ'),('Ꜫ','ꜫ'),('Ꜭ','ꜭ'),('Ꜯ','ꜯ'),('Ꜳ','ꜳ'),('Ꜵ','ꜵ'),('Ꜷ','ꜷ'),('Ꜹ','ꜹ'),('Ꜻ','ꜻ'),('Ꜽ','ꜽ'),('Ꜿ','ꜿ'),('Ꝁ','ꝁ'),('Ꝃ','ꝃ'),('Ꝅ','ꝅ'),('Ꝇ','ꝇ'),('Ꝉ','ꝉ'),('Ꝋ','ꝋ'),('Ꝍ','ꝍ'),('Ꝏ','ꝏ'),('Ꝑ','ꝑ'),('Ꝓ','ꝓ'),('Ꝕ','ꝕ'),('Ꝗ','ꝗ'),('Ꝙ','ꝙ'),('Ꝛ','ꝛ'),('Ꝝ','ꝝ'),('Ꝟ','ꝟ'),('Ꝡ','ꝡ'),('Ꝣ','ꝣ'),('Ꝥ','ꝥ'),('Ꝧ','ꝧ'),('Ꝩ','ꝩ'),('Ꝫ','ꝫ'),('Ꝭ','ꝭ'),('Ꝯ','ꝯ');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('Ꝺ','ꝺ'),('Ꝼ','ꝼ'),('Ᵹ','ᵹ'),('Ꝿ','ꝿ'),('Ꞁ','ꞁ'),('Ꞃ','ꞃ'),('Ꞅ','ꞅ'),('Ꞇ','ꞇ'),('Ꞌ','ꞌ'),('Ɥ','ɥ'),('Ꞑ','ꞑ'),('Ꞓ','ꞓ'),('Ꞗ','ꞗ'),('Ꞙ','ꞙ'),('Ꞛ','ꞛ'),('Ꞝ','ꞝ'),('Ꞟ','ꞟ'),('Ꞡ','ꞡ'),('Ꞣ','ꞣ'),('Ꞥ','ꞥ'),('Ꞧ','ꞧ'),('Ꞩ','ꞩ'),('Ɦ','ɦ'),('Ɜ','ɜ'),('Ɡ','ɡ'),('Ɬ','ɬ'),('Ɪ','ɪ'),('Ʞ','ʞ'),('Ʇ','ʇ'),('Ʝ','ʝ'),('Ꭓ','ꭓ'),('Ꞵ','ꞵ'),('Ꞷ','ꞷ'),('Ꞹ','ꞹ'),('Ꞻ','ꞻ'),('Ꞽ','ꞽ'),('Ꞿ','ꞿ'),('Ꟁ','ꟁ'),('Ꟃ','ꟃ'),('Ꞔ','ꞔ'),('Ʂ','ʂ'),('Ᶎ','ᶎ'),('Ꟈ','ꟈ'),('Ꟊ','ꟊ'),('Ɤ','ɤ'),('Ꟍ','ꟍ'),('꟎','꟏'),('Ꟑ','ꟑ'),('꟒','ꟓ'),('꟔','ꟕ'),('Ꟗ','ꟗ'),('Ꟙ','ꟙ'),('Ꟛ','ꟛ'),('Ƛ','ƛ'),('Ꟶ','ꟶ'),('Ａ','ａ'),('Ｂ','ｂ'),('Ｃ','ｃ'),('Ｄ','ｄ'),('Ｅ','ｅ'),('Ｆ','ｆ'),('Ｇ','ｇ'),('Ｈ','ｈ'),('Ｉ','ｉ'),('Ｊ','ｊ'),('Ｋ','ｋ'),('Ｌ','ｌ'),('Ｍ','ｍ'),('Ｎ','ｎ'),('Ｏ','ｏ'),('Ｐ','ｐ'),('Ｑ','ｑ'),('Ｒ','ｒ'),('Ｓ','ｓ'),('Ｔ','ｔ'),('Ｕ','ｕ'),('Ｖ','ｖ'),('Ｗ','ｗ'),('Ｘ','ｘ'),('Ｙ','ｙ'),('Ｚ','ｚ'),('𐐀','𐐨'),('𐐁','𐐩'),('𐐂','𐐪'),('𐐃','𐐫'),('𐐄','𐐬'),('𐐅','𐐭'),('𐐆','𐐮'),('𐐇','𐐯'),('𐐈','𐐰'),('𐐉','𐐱'),('𐐊','𐐲'),('𐐋','𐐳'),('𐐌','𐐴'),('𐐍','𐐵'),('𐐎','𐐶'),('𐐏','𐐷'),('𐐐','𐐸'),('𐐑','𐐹'),('𐐒','𐐺');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('𐐓','𐐻'),('𐐔','𐐼'),('𐐕','𐐽'),('𐐖','𐐾'),('𐐗','𐐿'),('𐐘','𐑀'),('𐐙','𐑁'),('𐐚','𐑂'),('𐐛','𐑃'),('𐐜','𐑄'),('𐐝','𐑅'),('𐐞','𐑆'),('𐐟','𐑇'),('𐐠','𐑈'),('𐐡','𐑉'),('𐐢','𐑊'),('𐐣','𐑋'),('𐐤','𐑌'),('𐐥','𐑍'),('𐐦','𐑎'),('𐐧','𐑏'),('𐒰','𐓘'),('𐒱','𐓙'),('𐒲','𐓚'),('𐒳','𐓛'),('𐒴','𐓜'),('𐒵','𐓝'),('𐒶','𐓞'),('𐒷','𐓟'),('𐒸','𐓠'),('𐒹','𐓡'),('𐒺','𐓢'),('𐒻','𐓣'),('𐒼','𐓤'),('𐒽','𐓥'),('𐒾','𐓦'),('𐒿','𐓧'),('𐓀','𐓨'),('𐓁','𐓩'),('𐓂','𐓪'),('𐓃','𐓫'),('𐓄','𐓬'),('𐓅','𐓭'),('𐓆','𐓮'),('𐓇','𐓯'),('𐓈','𐓰'),('𐓉','𐓱'),('𐓊','𐓲'),('𐓋','𐓳'),('𐓌','𐓴'),('𐓍','𐓵'),('𐓎','𐓶'),('𐓏','𐓷'),('𐓐','𐓸'),('𐓑','𐓹'),('𐓒','𐓺'),('𐓓','𐓻'),('𐕰','𐖗'),('𐕱','𐖘'),('𐕲','𐖙'),('𐕳','𐖚'),('𐕴','𐖛'),('𐕵','𐖜'),('𐕶','𐖝'),('𐕷','𐖞'),('𐕸','𐖟'),('𐕹','𐖠'),('𐕺','𐖡'),('𐕼','𐖣'),('𐕽','𐖤'),('𐕾','𐖥'),('𐕿','𐖦'),('𐖀','𐖧'),('𐖁','𐖨'),('𐖂','𐖩'),('𐖃','𐖪'),('𐖄','𐖫'),('𐖅','𐖬'),('𐖆','𐖭'),('𐖇','𐖮'),('𐖈','𐖯'),('𐖉','𐖰'),('𐖊','𐖱'),('𐖌','𐖳'),('𐖍','𐖴'),('𐖎','𐖵'),('𐖏','𐖶'),('𐖐','𐖷'),('𐖑','𐖸'),('𐖒','𐖹'),('𐖔','𐖻'),('𐖕','𐖼'),('𐲀','𐳀'),('𐲁','𐳁'),('𐲂','𐳂'),('𐲃','𐳃'),('𐲄','𐳄'),('𐲅','𐳅'),('𐲆','𐳆'),('𐲇','𐳇');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('𐲈','𐳈'),('𐲉','𐳉'),('𐲊','𐳊'),('𐲋','𐳋'),('𐲌','𐳌'),('𐲍','𐳍'),('𐲎','𐳎'),('𐲏','𐳏'),('𐲐','𐳐'),('𐲑','𐳑'),('𐲒','𐳒'),('𐲓','𐳓'),('𐲔','𐳔'),('𐲕','𐳕'),('𐲖','𐳖'),('𐲗','𐳗'),('𐲘','𐳘'),('𐲙','𐳙'),('𐲚','𐳚'),('𐲛','𐳛'),('𐲜','𐳜'),('𐲝','𐳝'),('𐲞','𐳞'),('𐲟','𐳟'),('𐲠','𐳠'),('𐲡','𐳡'),('𐲢','𐳢'),('𐲣','𐳣'),('𐲤','𐳤'),('𐲥','𐳥'),('𐲦','𐳦'),('𐲧','𐳧'),('𐲨','𐳨'),('𐲩','𐳩'),('𐲪','𐳪'),('𐲫','𐳫'),('𐲬','𐳬'),('𐲭','𐳭'),('𐲮','𐳮'),('𐲯','𐳯'),('𐲰','𐳰'),('𐲱','𐳱'),('𐲲','𐳲'),('𐵐','𐵰'),('𐵑','𐵱'),('𐵒','𐵲'),('𐵓','𐵳'),('𐵔','𐵴'),('𐵕','𐵵'),('𐵖','𐵶'),('𐵗','𐵷'),('𐵘','𐵸'),('𐵙','𐵹'),('𐵚','𐵺'),('𐵛','𐵻'),('𐵜','𐵼'),('𐵝','𐵽'),('𐵞','𐵾'),('𐵟','𐵿'),('𐵠','𐶀'),('𐵡','𐶁'),('𐵢','𐶂'),('𐵣','𐶃'),('𐵤','𐶄'),('𐵥','𐶅'),('𑢠','𑣀'),('𑢡','𑣁'),('𑢢','𑣂'),('𑢣','𑣃'),('𑢤','𑣄'),('𑢥','𑣅'),('𑢦','𑣆'),('𑢧','𑣇'),('𑢨','𑣈'),('𑢩','𑣉'),('𑢪','𑣊'),('𑢫','𑣋'),('𑢬','𑣌'),('𑢭','𑣍'),('𑢮','𑣎'),('𑢯','𑣏'),('𑢰','𑣐'),('𑢱','𑣑'),('𑢲','𑣒'),('𑢳','𑣓'),('𑢴','𑣔'),('𑢵','𑣕'),('𑢶','𑣖'),('𑢷','𑣗'),('𑢸','𑣘'),('𑢹','𑣙'),('𑢺','𑣚'),('𑢻','𑣛'),('𑢼','𑣜'),('𑢽','𑣝'),('𑢾','𑣞'),('𑢿','𑣟'),('𖹀','𖹠'),('𖹁','𖹡'),('𖹂','𖹢');
--> statement-breakpoint
INSERT INTO search_case_mapping(character, folded) VALUES ('𖹃','𖹣'),('𖹄','𖹤'),('𖹅','𖹥'),('𖹆','𖹦'),('𖹇','𖹧'),('𖹈','𖹨'),('𖹉','𖹩'),('𖹊','𖹪'),('𖹋','𖹫'),('𖹌','𖹬'),('𖹍','𖹭'),('𖹎','𖹮'),('𖹏','𖹯'),('𖹐','𖹰'),('𖹑','𖹱'),('𖹒','𖹲'),('𖹓','𖹳'),('𖹔','𖹴'),('𖹕','𖹵'),('𖹖','𖹶'),('𖹗','𖹷'),('𖹘','𖹸'),('𖹙','𖹹'),('𖹚','𖹺'),('𖹛','𖹻'),('𖹜','𖹼'),('𖹝','𖹽'),('𖹞','𖹾'),('𖹟','𖹿'),('𖺠','𖺻'),('𖺡','𖺼'),('𖺢','𖺽'),('𖺣','𖺾'),('𖺤','𖺿'),('𖺥','𖻀'),('𖺦','𖻁'),('𖺧','𖻂'),('𖺨','𖻃'),('𖺩','𖻄'),('𖺪','𖻅'),('𖺫','𖻆'),('𖺬','𖻇'),('𖺭','𖻈'),('𖺮','𖻉'),('𖺯','𖻊'),('𖺰','𖻋'),('𖺱','𖻌'),('𖺲','𖻍'),('𖺳','𖻎'),('𖺴','𖻏'),('𖺵','𖻐'),('𖺶','𖻑'),('𖺷','𖻒'),('𖺸','𖻓'),('𞤀','𞤢'),('𞤁','𞤣'),('𞤂','𞤤'),('𞤃','𞤥'),('𞤄','𞤦'),('𞤅','𞤧'),('𞤆','𞤨'),('𞤇','𞤩'),('𞤈','𞤪'),('𞤉','𞤫'),('𞤊','𞤬'),('𞤋','𞤭'),('𞤌','𞤮'),('𞤍','𞤯'),('𞤎','𞤰'),('𞤏','𞤱'),('𞤐','𞤲'),('𞤑','𞤳'),('𞤒','𞤴'),('𞤓','𞤵'),('𞤔','𞤶'),('𞤕','𞤷'),('𞤖','𞤸'),('𞤗','𞤹'),('𞤘','𞤺'),('𞤙','𞤻'),('𞤚','𞤼'),('𞤛','𞤽'),('𞤜','𞤾'),('𞤝','𞤿'),('𞤞','𞥀'),('𞤟','𞥁'),('𞤠','𞥂'),('𞤡','𞥃');
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'issues', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "issues";
--> statement-breakpoint
CREATE TRIGGER "issues_name_search_insert" AFTER INSERT ON "issues" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('issues',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "issues_name_search_update" AFTER UPDATE OF "name" ON "issues" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('issues',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "issues_search_delete" AFTER DELETE ON "issues" BEGIN DELETE FROM search_values WHERE source_table = 'issues' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'projects', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "projects";
--> statement-breakpoint
CREATE TRIGGER "projects_name_search_insert" AFTER INSERT ON "projects" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('projects',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "projects_name_search_update" AFTER UPDATE OF "name" ON "projects" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('projects',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'projects', id, 'identifier', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("identifier", 1, 256) WHERE length("identifier") > 0
    UNION ALL
    SELECT start + 256, substr("identifier", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "projects";
--> statement-breakpoint
CREATE TRIGGER "projects_identifier_search_insert" AFTER INSERT ON "projects" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('projects',NEW.id,'identifier',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."identifier", 1, 256) WHERE length(NEW."identifier") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."identifier", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "projects_identifier_search_update" AFTER UPDATE OF "identifier" ON "projects" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('projects',NEW.id,'identifier',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."identifier", 1, 256) WHERE length(NEW."identifier") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."identifier", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "projects_search_delete" AFTER DELETE ON "projects" BEGIN DELETE FROM search_values WHERE source_table = 'projects' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'workspaces', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "workspaces";
--> statement-breakpoint
CREATE TRIGGER "workspaces_name_search_insert" AFTER INSERT ON "workspaces" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('workspaces',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "workspaces_name_search_update" AFTER UPDATE OF "name" ON "workspaces" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('workspaces',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "workspaces_search_delete" AFTER DELETE ON "workspaces" BEGIN DELETE FROM search_values WHERE source_table = 'workspaces' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'user', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "user";
--> statement-breakpoint
CREATE TRIGGER "user_name_search_insert" AFTER INSERT ON "user" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('user',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "user_name_search_update" AFTER UPDATE OF "name" ON "user" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('user',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'user', id, 'username', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("username", 1, 256) WHERE length("username") > 0
    UNION ALL
    SELECT start + 256, substr("username", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "user";
--> statement-breakpoint
CREATE TRIGGER "user_username_search_insert" AFTER INSERT ON "user" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('user',NEW.id,'username',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."username", 1, 256) WHERE length(NEW."username") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."username", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "user_username_search_update" AFTER UPDATE OF "username" ON "user" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('user',NEW.id,'username',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."username", 1, 256) WHERE length(NEW."username") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."username", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "user_search_delete" AFTER DELETE ON "user" BEGIN DELETE FROM search_values WHERE source_table = 'user' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'profiles', id, 'first_name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("first_name", 1, 256) WHERE length("first_name") > 0
    UNION ALL
    SELECT start + 256, substr("first_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "profiles";
--> statement-breakpoint
CREATE TRIGGER "profiles_first_name_search_insert" AFTER INSERT ON "profiles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('profiles',NEW.id,'first_name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."first_name", 1, 256) WHERE length(NEW."first_name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."first_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "profiles_first_name_search_update" AFTER UPDATE OF "first_name" ON "profiles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('profiles',NEW.id,'first_name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."first_name", 1, 256) WHERE length(NEW."first_name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."first_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'profiles', id, 'last_name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("last_name", 1, 256) WHERE length("last_name") > 0
    UNION ALL
    SELECT start + 256, substr("last_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "profiles";
--> statement-breakpoint
CREATE TRIGGER "profiles_last_name_search_insert" AFTER INSERT ON "profiles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('profiles',NEW.id,'last_name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."last_name", 1, 256) WHERE length(NEW."last_name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."last_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "profiles_last_name_search_update" AFTER UPDATE OF "last_name" ON "profiles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('profiles',NEW.id,'last_name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."last_name", 1, 256) WHERE length(NEW."last_name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."last_name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "profiles_search_delete" AFTER DELETE ON "profiles" BEGIN DELETE FROM search_values WHERE source_table = 'profiles' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'stickies', id, 'description_stripped', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("description_stripped", 1, 256) WHERE length("description_stripped") > 0
    UNION ALL
    SELECT start + 256, substr("description_stripped", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "stickies";
--> statement-breakpoint
CREATE TRIGGER "stickies_description_stripped_search_insert" AFTER INSERT ON "stickies" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('stickies',NEW.id,'description_stripped',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."description_stripped", 1, 256) WHERE length(NEW."description_stripped") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."description_stripped", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "stickies_description_stripped_search_update" AFTER UPDATE OF "description_stripped" ON "stickies" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('stickies',NEW.id,'description_stripped',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."description_stripped", 1, 256) WHERE length(NEW."description_stripped") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."description_stripped", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "stickies_search_delete" AFTER DELETE ON "stickies" BEGIN DELETE FROM search_values WHERE source_table = 'stickies' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'draft_issues', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "draft_issues";
--> statement-breakpoint
CREATE TRIGGER "draft_issues_name_search_insert" AFTER INSERT ON "draft_issues" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('draft_issues',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "draft_issues_name_search_update" AFTER UPDATE OF "name" ON "draft_issues" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('draft_issues',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "draft_issues_search_delete" AFTER DELETE ON "draft_issues" BEGIN DELETE FROM search_values WHERE source_table = 'draft_issues' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'pages', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "pages";
--> statement-breakpoint
CREATE TRIGGER "pages_name_search_insert" AFTER INSERT ON "pages" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('pages',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "pages_name_search_update" AFTER UPDATE OF "name" ON "pages" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('pages',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "pages_search_delete" AFTER DELETE ON "pages" BEGIN DELETE FROM search_values WHERE source_table = 'pages' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'cycles', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "cycles";
--> statement-breakpoint
CREATE TRIGGER "cycles_name_search_insert" AFTER INSERT ON "cycles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('cycles',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "cycles_name_search_update" AFTER UPDATE OF "name" ON "cycles" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('cycles',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "cycles_search_delete" AFTER DELETE ON "cycles" BEGIN DELETE FROM search_values WHERE source_table = 'cycles' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'modules', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "modules";
--> statement-breakpoint
CREATE TRIGGER "modules_name_search_insert" AFTER INSERT ON "modules" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('modules',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "modules_name_search_update" AFTER UPDATE OF "name" ON "modules" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('modules',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "modules_search_delete" AFTER DELETE ON "modules" BEGIN DELETE FROM search_values WHERE source_table = 'modules' AND row_id = OLD.id; END;
--> statement-breakpoint
INSERT INTO search_values(source_table,row_id,field,value) SELECT 'issue_views', id, 'name', (WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr("name", 1, 256) WHERE length("name") > 0
    UNION ALL
    SELECT start + 256, substr("name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  )) FROM "issue_views";
--> statement-breakpoint
CREATE TRIGGER "issue_views_name_search_insert" AFTER INSERT ON "issue_views" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('issue_views',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "issue_views_name_search_update" AFTER UPDATE OF "name" ON "issue_views" BEGIN INSERT INTO search_values(source_table,row_id,field,value) VALUES ('issue_views',NEW.id,'name',(WITH RECURSIVE
  chunks(start, part) AS (
    SELECT 1, substr(NEW."name", 1, 256) WHERE length(NEW."name") > 0
    UNION ALL
    SELECT start + 256, substr(NEW."name", start + 256, 256) FROM chunks WHERE length(part) = 256
  ),
  chars(start, pos, part) AS (
    SELECT start, 1, part FROM chunks WHERE length(part) > 0
    UNION ALL
    SELECT start, pos + 1, part FROM chars WHERE pos < length(part)
  )
  SELECT coalesce(group_concat(folded_char, ''), '') FROM (
    SELECT coalesce((SELECT folded FROM search_case_mapping WHERE character = substr(part, pos, 1)),
      substr(part, pos, 1)) AS folded_char FROM chars ORDER BY start, pos
  ))) ON CONFLICT(source_table,row_id,field) DO UPDATE SET value=excluded.value; END;
--> statement-breakpoint
CREATE TRIGGER "issue_views_search_delete" AFTER DELETE ON "issue_views" BEGIN DELETE FROM search_values WHERE source_table = 'issue_views' AND row_id = OLD.id; END;

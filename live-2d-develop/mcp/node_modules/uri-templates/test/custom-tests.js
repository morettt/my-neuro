var UriTemplate = require('../uri-templates');
var assert = require('proclaim');

describe("Guessing variable priority", function () {
	it('GitHub issue #8', function () {
		var template = new UriTemplate("{+path}/c/capture{/date,id,page}");
		var guess = template.fromUri('/a/b/c/capture/20140101/1');

		// we already test elsewhere that this reconstructs correctly - we just want to make sure variables are prioritised left-to-right
		assert.strictEqual(guess.date, '20140101');
		assert.strictEqual(guess.id, '1');
		assert.strictEqual(guess.page, undefined);
	})
});

describe("Original string available", function () {
	it('GitHub issue #7', function () {
		var template = new UriTemplate("{+path}/c/capture{/date,id,page}");

		assert.strictEqual(template.template, '{+path}/c/capture{/date,id,page}');
		assert.strictEqual(template + "", '{+path}/c/capture{/date,id,page}');
	})
});

describe("Query optional when decoding", function () {
	it('GitHub issue #12', function () {
		var template = new UriTemplate("{/type,ids,field}{?query*}");

		var uri = '/user/1,2,3/posts';
		var guess = template.fromUri(uri);
		assert.isObject(guess);

		var trimmed = template.fill(guess).replace(/\?$/, '');
		assert.strictEqual(trimmed, uri);
	});
});

describe("Decode empty query", function () {
	it('Must return a empty object', function () {
        var template = new UriTemplate('{?query}');

        var uri = '?';
        var guess = template.fromUri(uri);

        assert.isUndefined(guess['']);
    });

	it('Must return a empty object in property', function () {
        var template = new UriTemplate('{?query*}');

        var uri = '?';
        var guess = template.fromUri(uri);

        assert.isUndefined(guess['']);
    });
});

describe('strict match example', function () {
	it('does not match invalid "/"', function () {
		var template = UriTemplate("/prefix/{value}/{suffix}");

		var looseMatch = template.fromUri('/prefix/foo/bar/suffix');
		var strictMatch = template.fromUri('/prefix/foo/bar/suffix', {strict: true});
		assert.isObject(looseMatch);
		assert.isUndefined(strictMatch);
	});
});

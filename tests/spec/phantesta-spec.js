import child_process from 'child_process';
import { createPage, HtmlServer, safeRequest, sleep, startServer, syncify } from 'jasmine_test_utils';
import fs from 'fs';
import path from 'path';
import phantom from 'phantom';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import firefox from 'selenium-webdriver/firefox';
import rp from 'request-promise';

import Phantesta from '../../src/phantesta';

describe('phantesta', function() {
  var htmlServer = null;
  var phantesta = null;
  var page = null;
  beforeAll(syncify(async function() {
    htmlServer = new HtmlServer({
      host: 'localhost',
      port: '7555',
      dir: path.resolve(__dirname, '..'),
    });
    htmlServer.start();
  }));
  describe('phantomjs', function() {
    var instance = null;
    var diffPage = null;
    beforeAll(syncify(async function() {
      instance = await phantom.create(['--web-security=false']);
      diffPage = await instance.createPage();
    }));
    afterAll(syncify(async function() {
      await instance.exit();
    }));
    beforeEach(syncify(async function() {
      phantesta = new Phantesta(diffPage, {
        screenshotPath: path.resolve(__dirname, '../screenshots'),
      });
      page = await createPage(instance);
    }));
    afterEach(syncify(async function() {
      if (page) {
        await instance.execute('phantom', 'invokeMethod', ['clearCookies']);
        await page.close();
        page = null;
      }
      phantesta.destructiveClearAllSnapshots();
    }));

    describe('functionality', function() {
      it('should test basic functionality', syncify(async function() {
        var url1 = htmlServer.getUrl('/html/page1.html');
        var url2 = htmlServer.getUrl('/html/page2.html');

        await page.open(url1);
        await phantesta.expectUnstable(page, 'html', 'page1');
        await phantesta.expectUnstable(page, 'html', 'page1_2');
        await phantesta.acceptDiff('page1');
        await phantesta.acceptDiff('page1_2');
        await phantesta.expectStable(page, 'html', 'page1');
        await phantesta.expectStable(page, 'html', 'page1_2');

        await page.open(url2);
        await phantesta.expectUnstable(page, 'html', 'page2');
        await phantesta.acceptDiff('page2');
        await phantesta.expectSame('page1', 'page1_2');
        await phantesta.expectDiff('page1', 'page2');
      }), 20000);
      it('should work with large pages', syncify(async function() {
        var url1 = htmlServer.getUrl('/html/image.html');

        await page.open(url1);
        await phantesta.expectUnstable(page, 'html', 'image1');
        await phantesta.acceptDiff('image1');
        await phantesta.expectStable(page, 'html', 'image1');

        await page.evaluate(function() {
          var t = document.createTextNode('blah');
          document.body.appendChild(t);
        });

        await phantesta.expectUnstable(page, 'html', 'image1');
        await phantesta.acceptDiff('image1');
        await phantesta.expectStable(page, 'html', 'image1');
      }), 20000);
      it('should serve diffs correctly', syncify(async function() {
        phantesta.startServer({host: 'localhost', port: '7992'});
        var url1 = htmlServer.getUrl('/html/page1.html');
        var url2 = htmlServer.getUrl('/html/page2.html');

        await page.open(url1);
        await phantesta.expectUnstable(page, 'html', 'page1');
        await phantesta.acceptDiff('page1');
        await phantesta.expectUnstable(page, 'html', 'page1_2');
        var response = JSON.parse(await rp('http://localhost:7992/list_of_diffs'));
        expect(response.diffs.length).toBe(1);
        expect(response.diffs[0].name).toBe('page1_2');
        expect(response.diffs[0].goodSrc).toBeTruthy();
        expect(response.diffs[0].newSrc).toBeTruthy();
        expect(response.diffs[0].diffSrc).toBeTruthy();

        await page.open(url2);
        await phantesta.expectUnstable(page, 'html', 'page1');
        var response = JSON.parse(await rp('http://localhost:7992/list_of_diffs'));
        expect(response.diffs.length).toBe(2);
        expect(response.diffs[1].name).toBe('page1');
        expect(response.diffs[1].goodSrc).toBeTruthy();
        expect(response.diffs[1].newSrc).toBeTruthy();
        expect(response.diffs[1].diffSrc).toBeTruthy();

        response.diffs[1].replace = true;
        var response = await rp({
          url: 'http://localhost:7992/submit_diffs',
          method: 'post',
          json: true,
          body: {
            diffs: response.diffs,
          },
        });
        expect(response.status).toBe('success');

        var response = JSON.parse(await rp('http://localhost:7992/list_of_diffs'));
        expect(response.diffs.length).toBe(1);
        expect(response.diffs[0].name).toBe('page1_2');

        var response = await rp({
          url: 'http://localhost:7992/clear_diffs',
          method: 'post',
          json: true,
        });
        expect(response.status).toBe('success');

        var response = JSON.parse(await rp('http://localhost:7992/list_of_diffs'));
        expect(response.diffs.length).toBe(0);
      }), 20000);
    });
  });
  describe('selenium', function() {
    var diffPage = null;
    var page = null;
    var createDriver = async function() {
      var tmpdir = fs.mkdtempSync('/tmp/phantesta');
      var chromeOpts = new chrome.Options();
      chromeOpts.addArguments('--user-data-dir=' + tmpdir);
      var profile = new firefox.Profile();
      var firefoxOpts = new firefox.Options();
      firefoxOpts.setProfile(profile);
      return new Builder()
          .forBrowser('firefox')
          .setChromeOptions(chromeOpts)
          .setFirefoxOptions(firefoxOpts)
          .build();
    };
    beforeAll(syncify(async function() {
      diffPage = await createDriver();
    }));
    afterAll(syncify(async function() {
      await diffPage.quit();
    }));
    beforeEach(syncify(async function() {
      phantesta = new Phantesta(diffPage, {
        screenshotPath: path.resolve(__dirname, '../screenshots'),
      });
      page = await createDriver();
    }));
    afterEach(syncify(async function() {
      await page.quit();
      phantesta.destructiveClearAllSnapshots();
    }));
    it('should test basic functionality', syncify(async function() {
      var url1 = htmlServer.getUrl('/html/page1.html');
      var url2 = htmlServer.getUrl('/html/page2.html');

      await page.get(url1);
      await phantesta.expectUnstable(page, 'html', 'selenium_page1');
      await phantesta.expectUnstable(page, 'html', 'selenium_page1_2');
      await phantesta.acceptDiff('selenium_page1');
      await phantesta.acceptDiff('selenium_page1_2');
      await phantesta.expectStable(page, 'html', 'selenium_page1');
      await phantesta.expectStable(page, 'html', 'selenium_page1_2');

      await page.get(url2);
      await phantesta.expectUnstable(page, 'html', 'selenium_page2');
      await phantesta.acceptDiff('selenium_page2');
      await phantesta.expectSame('selenium_page1', 'selenium_page1_2');
      await phantesta.expectDiff('selenium_page1', 'selenium_page2');
    }), 20000);
  });
});

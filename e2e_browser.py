# Browser walkthrough of all three tabs (needs: pip install playwright). Run: python3 e2e_browser.py
import asyncio
from playwright.async_api import async_playwright
import pathlib
ROOT=pathlib.Path(__file__).resolve().parent
APP=(ROOT/'Kaizen-Sheet-Maker.html').as_uri()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1280,'height':900}, accept_downloads=True); pg=await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP); await pg.wait_for_timeout(500)
        print('1 status:', await pg.inner_text('#sheetStatus'))
        await pg.click('#btnExample'); await pg.wait_for_timeout(300)
        print('2 after example:', await pg.inner_text('#sheetStatus'), '| bar', await pg.inner_text('#barTotal'))
        await pg.click('#btnSave'); await pg.wait_for_timeout(500)
        print('3 saved:', await pg.inner_text('#sheetStatus'), '| count', await pg.inner_text('#regCount'))
        # quick calculator
        await pg.click('#tab-quick'); await pg.wait_for_timeout(200)
        await pg.click('#quickAdd button:has-text("Rejection")'); await pg.wait_for_timeout(200)
        for f,v in [('before','15'),('after','2'),('cost','15000'),('inv','840000')]:
            await pg.fill(f'#quickLines [data-f="{f}"]', v)
        await pg.wait_for_timeout(200)
        print('4 quick bar:', await pg.inner_text('#barTotal'))
        await pg.screenshot(path=str(ROOT/'out')+'/quick.png')
        await pg.click('#btnQToSheet'); await pg.wait_for_timeout(1500)
        print('5 sheet lines:', len(await pg.query_selector_all('#sheetLines .line')), '| bar', await pg.inner_text('#barTotal'))
        # new kaizen, type, then try opening the saved one -> confirm
        await pg.click('#btnNew'); await pg.wait_for_timeout(300)
        await pg.fill('#kaizenNo','T-2'); await pg.fill('#problem','Operators searching for tools, 20 min per shift lost.'); await pg.wait_for_timeout(500)
        print('6 new status:', await pg.inner_text('#sheetStatus'))
        await pg.click('#tab-register'); await pg.wait_for_timeout(300)
        print('7 tiles:', (await pg.inner_text('#regTiles')).replace('\n',' | '))
        await pg.click('[data-open]'); await pg.wait_for_timeout(300)
        print('8 confirm:', await pg.inner_text('#regConfirm'))
        await pg.click('#regConfirm button:has-text("Save it")'); await pg.wait_for_timeout(800)
        print('9 opened:', await pg.input_value('#kaizenNo'), '| count', await pg.inner_text('#regCount'))
        await pg.click('#tab-register'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(ROOT/'out')+'/register.png', full_page=True)
        async with pg.expect_download() as dl: await pg.click('#btnRegXlsx')
        await (await dl.value).save_as(str(ROOT/'out')+'/register-ui.xlsx')
        async with pg.expect_download() as dl2: await pg.click('[data-xl]')
        await (await dl2.value).save_as(str(ROOT/'out')+'/row-ui.xlsx')
        # delete with confirm
        n0=len(await pg.query_selector_all('[data-del]'))
        await pg.click('tr:not(.current) [data-del]'); await pg.wait_for_timeout(200)
        await pg.click('#regConfirm button:has-text("Delete")'); await pg.wait_for_timeout(500)
        print('10 rows', n0, '->', len(await pg.query_selector_all('[data-del]')))
        await pg.reload(); await pg.wait_for_timeout(800)
        print('11 after reload: count', await pg.inner_text('#regCount'), '| sheet', await pg.input_value('#kaizenNo'), '| tab', await pg.get_attribute('#tab-register','aria-selected'))
        m=await ctx.new_page(); await m.set_viewport_size({'width':390,'height':800}); await m.goto(APP+'#register'); await m.wait_for_timeout(800)
        await m.screenshot(path=str(ROOT/'out')+'/mobile-register.png'); print('12 mobile width', await m.evaluate('document.documentElement.scrollWidth'))
        print('errors', errs); await b.close()
asyncio.run(main())

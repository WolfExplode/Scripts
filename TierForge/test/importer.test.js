import test from 'node:test';
import assert from 'node:assert/strict';
import { originalWikiImageUrl, parseCharacters, parseTemplateCode, parseWikiCards, parseWikiRelics, prettyName,
  selectNamedItems } from '../src/importer.js';

test('prettyName derives a readable item name', () => {
  assert.equal(prettyName('ashenStrike_card.png'), 'Ashen Strike Card');
});

test('parseTemplateCode retains rows and placements', () => {
  const result = parseTemplateCode('<script>templateCode = "cards==Great|1|12|13==Okay|3|14"</script>');
  assert.equal(result.template, 'cards');
  assert.deepEqual(result.tiers[0], { label: 'Great', color: '#ffbf7f', ids: ['12', '13'] });
});

test('parseCharacters reads TierMaker tiles', () => {
  const result = parseCharacters('<div id="4" class="character" title="Bash" style="background-image:url(&quot;/bash.png&quot;)"></div>');
  assert.deepEqual(result, [{ key: '4', src: 'https://tiermaker.com/bash.png', name: 'Bash' }]);
});

test('originalWikiImageUrl removes the MediaWiki thumbnail segment', () => {
  assert.equal(originalWikiImageUrl('https://slaythespire.wiki.gg/images/thumb/a/a1/Card.png/150px-Card.png'),
    'https://slaythespire.wiki.gg/images/a/a1/Card.png');
});

test('parseWikiCards extracts searchable metadata', () => {
  const html = '<div class="card-box" data-name="Test Card" data-color="Ironclad" data-rarity="Rare" data-type="Attack" data-tags="Strike, Fire" data-cost="2">' +
    '<div class="img-base"><img src="/images/Test.png"></div><div class="desc-base">Deal <b>12</b> damage.</div></div>';
  const [card] = parseWikiCards(html);
  assert.equal(card.name, 'Test Card');
  assert.equal(card.src, 'https://slaythespire.wiki.gg/images/Test.png');
  assert.deepEqual(card.tags, ['Ironclad', 'Rare', 'Attack', 'Strike', 'Fire']);
  assert.equal(card.notes, 'Cost 2. Deal 12 damage.');
});

test('parseWikiRelics extracts relic metadata and original image URLs', () => {
  const html = '<div class="relic-box" data-name="Arcane Scroll" data-rarity="Common" data-character="Any" data-ancient-upgrade="Yes" data-tags="Draw, Magic">' +
    '<span class="img-base"><img src="/images/thumb/StS2_ArcaneScroll.png/80px-StS2_ArcaneScroll.png"></span>' +
    '<div class="relic-desc">Draw <b>2</b> cards.</div></div>';
  const [relic] = parseWikiRelics(html);
  assert.equal(relic.name, 'Arcane Scroll');
  assert.equal(relic.src, 'https://slaythespire.wiki.gg/images/StS2_ArcaneScroll.png');
  assert.deepEqual(relic.tags, ['Common', 'Any', 'Ancient', 'Draw', 'Magic']);
  assert.equal(relic.notes, 'Draw 2 cards.');
});

test('named item selection is punctuation-insensitive and optional', () => {
  const items = [{ name: 'Ashen Strike' }, { name: 'All For One' }, { name: 'Pomander' }];
  assert.deepEqual(selectNamedItems(items, ['ashen-strike', 'All_for_One']), items.slice(0, 2));
  assert.deepEqual(selectNamedItems(items, ['80px StS2Pomander']), items.slice(2));
  assert.equal(selectNamedItems(items), items);
  assert.deepEqual(selectNamedItems(items, []), []);
});

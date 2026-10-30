/* Skid Row Diaries · watch page (test bench)
   All tracking lives in srd-tracker.js. This file only draws the page and runs the form. */
(function () {
  'use strict';

  const EPISODES = [
    { vimeo: '1210983580', label: 'Episode 01', name: 'Michael Steger', line: 'A gentle giant.' },
    { vimeo: '1209284450', label: 'Episode 02', name: 'LaJeune McDonald', line: 'Angels among us.' },
    { vimeo: '1210982273', label: 'Episode 04', name: 'Ronald Coulter', line: '“But I have memories.”' }
  ];

  const $ = (id) => document.getElementById(id);
  const list = $('episodes');

  function render(locked) {
    list.innerHTML = '';
    list.setAttribute('aria-busy', locked ? 'true' : 'false');
    EPISODES.forEach((ep, i) => {
      const art = document.createElement('article');
      art.className = 'ep';
      art.innerHTML = '<p class="ep-label"></p><h2 class="ep-name"></h2><div class="ep-frame"></div><p class="ep-line"></p>';
      art.querySelector('.ep-label').textContent = ep.label;
      art.querySelector('.ep-name').textContent = ep.name;
      art.querySelector('.ep-line').textContent = ep.line;
      const frame = art.querySelector('.ep-frame');
      if (locked) {
        const lock = document.createElement('div');
        lock.className = 'ep-lock';
        lock.textContent = 'Enter your name and email above to watch';
        frame.appendChild(lock);
      } else {
        const f = document.createElement('iframe');
        f.src = 'https://player.vimeo.com/video/' + ep.vimeo + '?badge=0&autopause=0&title=0&byline=0&portrait=0&dnt=1';
        f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.title = ep.name;
        f.loading = i === 0 ? 'eager' : 'lazy';
        f.setAttribute('data-srd-video', ep.vimeo);
        f.setAttribute('data-srd-title', ep.name);
        frame.appendChild(f);
      }
      list.appendChild(art);
    });
    if (!locked) SRD.attachAll(list);
  }

  function unlock() {
    const v = SRD.viewer() || {};
    $('gate').hidden = true;
    $('outro').hidden = false;
    const signed = $('signed-as');
    signed.hidden = false;
    signed.textContent = 'Watching as ' + (v.first_name || v.email || ('@' + (v.ig_handle || 'you'))) + '. ';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Not you?';
    reset.addEventListener('click', () => { SRD.forget(); location.reload(); });
    signed.appendChild(reset);
    render(false);
  }

  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('gate-error');
    const r = SRD.signup({ first_name: $('first').value, email: $('email').value, form: 'watch' });
    if (!r.ok) {
      err.textContent = r.error === 'first_name' ? 'Please add your first name.' : 'Please enter a full email address.';
      err.hidden = false;
      $(r.error === 'first_name' ? 'first' : 'email').focus();
      return;
    }
    err.hidden = true;
    unlock();
    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if (SRD.isKnown()) {
    unlock();
  } else {
    $('gate').hidden = false;
    render(true);
    SRD.gateShown();
  }
})();

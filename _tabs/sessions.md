---
icon: fas fa-chalkboard-user
order: 9
---

Talks, workshops and presentations I have given. Each entry opens the slides.

<style>
  .session-list {
    list-style: none;
    padding-left: 0;
    margin: 1.5rem 0 0;
  }

  .session-list > li {
    margin-bottom: 0.75rem;
  }

  .session-card {
    display: block;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--main-border-color);
    border-radius: 0.5rem;
    background: var(--card-bg);
    color: var(--text-color);
    text-decoration: none;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .session-card:hover {
    background: var(--card-hover-bg);
    border-color: var(--link-color);
    text-decoration: none;
  }

  .session-card .session-title {
    font-weight: 600;
    color: var(--heading-color);
  }

  .session-card:hover .session-title {
    color: var(--link-color);
  }

  .session-card .session-kind {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--main-border-color);
    border-radius: 0.75rem;
    font-size: 0.7rem;
    font-weight: 400;
    letter-spacing: 0.02em;
    color: var(--text-muted-color);
    vertical-align: 0.1rem;
  }

  .session-card .session-meta,
  .session-card .session-desc {
    display: block;
    margin-top: 0.3rem;
    font-size: 0.85rem;
  }

  .session-card .session-meta {
    color: var(--text-muted-color);
  }

  .session-card .session-desc {
    font-size: 0.9rem;
  }
</style>

{% assign sessions = site.data.sessions %}
{% if sessions and sessions.size > 0 %}
<ul class="session-list">
  {% for s in sessions %}
  <li>
    <a
      class="session-card"
      href="{{ s.url }}"
      {% if s.url contains '://' %}target="_blank" rel="noopener noreferrer"{% endif %}
    >
      <span class="session-title"
        >{{ s.title }}{% if s.kind %}<span class="session-kind">{{ s.kind }}</span>{% endif %}</span
      >
      {% if s.event or s.date %}
      <span class="session-meta">
        {%- if s.event %}{{ s.event }}{% endif -%}
        {%- if s.event and s.date %} · {% endif -%}
        {%- if s.date %}{{ s.date | date: '%b %Y' }}{% endif -%}
      </span>
      {% endif %}
      {% if s.description %}
      <span class="session-desc">{{ s.description }}</span>
      {% endif %}
    </a>
  </li>
  {% endfor %}
</ul>
{% else %}
*No sessions listed yet.*
{% endif %}

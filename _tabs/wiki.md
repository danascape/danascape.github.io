---
icon: fas fa-book-open
order: 6
---

Step-by-step installation and setup Wiki.

---

{% if site.wiki.size > 0 %}
{% assign wiki_pages = site.wiki | sort: 'date' | reverse %}
{% for page in wiki_pages %}
### [{{ page.title }}]({{ page.url }})

{{ page.description }}

{% endfor %}
{% endif %}

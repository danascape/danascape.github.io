---
icon: fas fa-microchip
order: 8
---

Linux kernel trees I maintain and release.

---

{% if site.kernel.size > 0 %}
{% assign kernels = site.kernel | sort: 'date' | reverse %}
{% for kernel in kernels %}
### [{{ kernel.title }}]({{ kernel.url }})

{{ kernel.description }}

{% endfor %}
{% else %}
*No kernel trees listed yet.*
{% endif %}

package fingerprint

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Finding struct {
	Tech       string `json:"tech"`
	Confidence string `json:"confidence"` // "high" | "medium" | "low"
	Evidence   string `json:"evidence"`
	Category   string `json:"category"` // "server" | "language" | "framework" | "cms" | "database" | "security"
}

type Profile struct {
	Target     string            `json:"target"`
	Findings   []Finding         `json:"findings"`
	Headers    map[string]string `json:"headers"`
	StatusCode int               `json:"statusCode"`
}

var httpClient = &http.Client{
	Timeout: 8 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

type profiler struct {
	base string
	mu   sync.Mutex
	out  []Finding
	seen map[string]bool
}

func newProfiler(baseURL string) *profiler {
	for strings.HasSuffix(baseURL, "/") {
		baseURL = baseURL[:len(baseURL)-1]
	}
	return &profiler{base: baseURL, seen: make(map[string]bool)}
}

func (p *profiler) add(tech, conf, evidence, cat string) {
	key := cat + "|" + tech
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.seen[key] {
		p.seen[key] = true
		p.out = append(p.out, Finding{Tech: tech, Confidence: conf, Evidence: evidence, Category: cat})
	}
}

func (p *profiler) fetch(path string) (*http.Response, []byte, error) {
	req, err := http.NewRequest("GET", p.base+path, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; HarnessScanner/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	return resp, body, nil
}

// Run performs active tech stack fingerprinting against baseURL.
func Run(baseURL string) *Profile {
	p := newProfiler(baseURL)
	headers := map[string]string{}
	statusCode := 0

	// Phase 1: root request
	if resp, body, err := p.fetch("/"); err == nil {
		statusCode = resp.StatusCode
		for k, vs := range resp.Header {
			if len(vs) > 0 {
				headers[k] = vs[0]
			}
		}
		p.headers(resp)
		p.body(body)
		p.cookies(resp)
	}

	// Phase 2: path probes (concurrent)
	type probe struct {
		path string
		fn   func(*http.Response, []byte)
	}
	probes := []probe{
		{"/phpinfo.php", p.probePhpInfo},
		{"/info.php", p.probePhpInfo},
		{"/server-status", p.probeApacheStatus},
		{"/server-info", p.probeApacheInfo},
		{"/.htaccess", p.probeHtaccess},
		{"/nginx_status", p.probeNginx},
		{"/wp-login.php", p.probeWP},
		{"/wp-admin/", p.probeWP},
		{"/wp-content/themes/", p.probeWP},
		{"/administrator/index.php", p.probeJoomla},
		{"/sites/default/settings.php", p.probeDrupal},
		{"/actuator/health", p.probeSpring},
		{"/actuator", p.probeSpring},
		{"/elmah.axd", p.probeElmah},
		{"/.git/HEAD", p.probeGit},
		{"/.env", p.probeDotEnv},
		{"/web.config", p.probeWebConfig},
		{"/WEB-INF/web.xml", p.probeJEE},
		{"/manager/html", p.probeTomcat},
		{"/phpmyadmin/", p.probePhpMyAdmin},
		{"/adminer.php", p.probeAdminer},
		{"/graphql", p.probeGraphQL},
		{"/graphiql", p.probeGraphQL},
		{"/debug/pprof/", p.probeGoPprof},
		{"/metrics", p.probePrometheus},
		{"/console", p.probeJBoss},
		{"/jmx-console/", p.probeJBoss},
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for _, pr := range probes {
		wg.Add(1)
		pr := pr
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if resp, body, err := p.fetch(pr.path); err == nil {
				pr.fn(resp, body)
			}
		}()
	}
	wg.Wait()

	// Phase 3: 404 error page fingerprint
	if _, body, err := p.fetch("/harness-nonexistent-probe-8x7y6z"); err == nil {
		p.probe404(body)
	}

	return &Profile{
		Target:     baseURL,
		Findings:   p.out,
		Headers:    headers,
		StatusCode: statusCode,
	}
}

func (p *profiler) headers(resp *http.Response) {
	srv := resp.Header.Get("Server")
	if srv != "" {
		sl := strings.ToLower(srv)
		switch {
		case strings.Contains(sl, "apache"):
			p.add("Apache", "high", "Server: "+srv, "server")
		case strings.Contains(sl, "nginx"):
			p.add("Nginx", "high", "Server: "+srv, "server")
		case strings.Contains(sl, "microsoft-iis") || strings.Contains(sl, "iis"):
			p.add("IIS", "high", "Server: "+srv, "server")
			p.add("Windows Server", "high", "IIS → Windows", "server")
		case strings.Contains(sl, "openresty"):
			p.add("OpenResty (Nginx)", "high", "Server: "+srv, "server")
		case strings.Contains(sl, "litespeed"):
			p.add("LiteSpeed", "high", "Server: "+srv, "server")
		case strings.Contains(sl, "caddy"):
			p.add("Caddy", "high", "Server: "+srv, "server")
		case strings.Contains(sl, "gunicorn"):
			p.add("Gunicorn", "high", "Server: "+srv, "server")
			p.add("Python", "high", "Gunicorn is a Python WSGI server", "language")
		case strings.Contains(sl, "tornado"):
			p.add("Tornado", "high", "Server: "+srv, "server")
			p.add("Python", "high", "Tornado is a Python framework", "language")
		case strings.Contains(sl, "jetty"):
			p.add("Jetty", "high", "Server: "+srv, "server")
			p.add("Java", "high", "Jetty is a Java server", "language")
		case strings.Contains(sl, "tomcat"):
			p.add("Apache Tomcat", "high", "Server: "+srv, "server")
			p.add("Java", "high", "Tomcat is a Java server", "language")
		case strings.Contains(sl, "kestrel"):
			p.add("Kestrel (.NET)", "high", "Server: "+srv, "server")
			p.add("ASP.NET Core", "high", "Kestrel is the ASP.NET Core server", "framework")
		case strings.Contains(sl, "puma") || strings.Contains(sl, "unicorn") || strings.Contains(sl, "passenger"):
			p.add(srv, "high", "Server: "+srv, "server")
			p.add("Ruby", "high", srv+" is a Ruby server", "language")
		}
		if strings.Contains(sl, "php") {
			p.add("PHP", "medium", "PHP in Server header", "language")
		}
	}

	if xpb := resp.Header.Get("X-Powered-By"); xpb != "" {
		xl := strings.ToLower(xpb)
		p.add(xpb, "high", "X-Powered-By: "+xpb, "language")
		if strings.Contains(xl, "php") {
			p.add("PHP", "high", "X-Powered-By: "+xpb, "language")
		}
		if strings.Contains(xl, "asp.net") {
			p.add("ASP.NET", "high", "X-Powered-By: "+xpb, "framework")
		}
		if strings.Contains(xl, "express") {
			p.add("Express.js", "high", "X-Powered-By: "+xpb, "framework")
			p.add("Node.js", "high", "Express.js runs on Node.js", "language")
		}
		if strings.Contains(xl, "next.js") {
			p.add("Next.js", "high", "X-Powered-By: "+xpb, "framework")
		}
	}

	if v := resp.Header.Get("X-AspNet-Version"); v != "" {
		p.add("ASP.NET", "high", "X-AspNet-Version: "+v, "framework")
	}
	if v := resp.Header.Get("X-AspNetMvc-Version"); v != "" {
		p.add("ASP.NET MVC", "high", "X-AspNetMvc-Version: "+v, "framework")
	}
	if resp.Header.Get("X-Drupal-Cache") != "" || resp.Header.Get("X-Drupal-Dynamic-Cache") != "" {
		p.add("Drupal", "high", "X-Drupal-Cache header", "cms")
		p.add("PHP", "high", "Drupal runs on PHP", "language")
	}
	if v := resp.Header.Get("X-Generator"); v != "" {
		p.add(v, "high", "X-Generator: "+v, "framework")
	}

	// CDN / WAF
	if resp.Header.Get("CF-RAY") != "" || resp.Header.Get("CF-Cache-Status") != "" {
		p.add("Cloudflare", "high", "Cloudflare headers present", "security")
	}
	if resp.Header.Get("X-Cache") != "" || resp.Header.Get("X-Varnish") != "" {
		p.add("Varnish Cache", "high", "Varnish headers present", "server")
	}
	if resp.Header.Get("X-Sucuri-ID") != "" {
		p.add("Sucuri WAF", "high", "X-Sucuri-ID header", "security")
	}
	if resp.Header.Get("X-Mod-Pagespeed") != "" {
		p.add("mod_pagespeed", "high", "X-Mod-Pagespeed header", "server")
	}

	// Security header gaps
	if resp.Header.Get("X-Frame-Options") == "" && resp.Header.Get("Content-Security-Policy") == "" {
		p.add("No Clickjacking Protection", "low", "Missing X-Frame-Options and CSP", "security")
	}
	if resp.Header.Get("Strict-Transport-Security") == "" {
		p.add("No HSTS", "low", "Missing Strict-Transport-Security", "security")
	}
}

func (p *profiler) cookies(resp *http.Response) {
	for _, c := range resp.Cookies() {
		switch c.Name {
		case "PHPSESSID":
			p.add("PHP", "high", "PHPSESSID cookie", "language")
		case "JSESSIONID":
			p.add("Java EE", "high", "JSESSIONID cookie", "language")
		case "ASP.NET_SessionId":
			p.add("ASP.NET", "high", "ASP.NET_SessionId cookie", "framework")
		case "laravel_session":
			p.add("Laravel", "high", "laravel_session cookie", "framework")
			p.add("PHP", "high", "Laravel → PHP", "language")
		case "django_session":
			p.add("Django", "high", "django_session cookie", "framework")
			p.add("Python", "high", "Django → Python", "language")
		case "rack.session":
			p.add("Ruby/Rack", "high", "rack.session cookie", "framework")
			p.add("Ruby", "high", "Rack → Ruby", "language")
		}
		lname := strings.ToLower(c.Name)
		if strings.HasPrefix(lname, "wp-") || strings.HasPrefix(lname, "wordpress_") {
			p.add("WordPress", "high", "Cookie: "+c.Name, "cms")
		}
		if strings.HasPrefix(lname, "ci_session") {
			p.add("CodeIgniter", "high", "ci_session cookie", "framework")
			p.add("PHP", "high", "CodeIgniter → PHP", "language")
		}
	}
}

func (p *profiler) body(body []byte) {
	s := string(body)
	lower := strings.ToLower(s)

	// Meta generator
	genRe := regexp.MustCompile(`(?i)<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']`)
	if m := genRe.FindStringSubmatch(s); len(m) > 1 {
		gen := m[1]
		p.add(gen, "high", "meta generator: "+gen, "cms")
		gl := strings.ToLower(gen)
		if strings.Contains(gl, "wordpress") {
			p.add("PHP", "high", "WordPress → PHP", "language")
		}
		if strings.Contains(gl, "drupal") {
			p.add("PHP", "high", "Drupal → PHP", "language")
		}
		if strings.Contains(gl, "joomla") {
			p.add("PHP", "high", "Joomla → PHP", "language")
		}
	}

	// WordPress signatures
	if strings.Contains(lower, "wp-content/") || strings.Contains(lower, "wp-includes/") {
		p.add("WordPress", "high", "wp-content/wp-includes in HTML", "cms")
		p.add("PHP", "high", "WordPress → PHP", "language")
	}

	// JavaScript frameworks
	if strings.Contains(s, "data-reactroot") || strings.Contains(s, "__NEXT_DATA__") || strings.Contains(s, "_react") {
		p.add("React", "medium", "React signatures in HTML", "framework")
	}
	if strings.Contains(s, "__NUXT__") || strings.Contains(lower, "nuxt") {
		p.add("Nuxt.js (Vue)", "medium", "Nuxt.js signature in HTML", "framework")
	}
	if strings.Contains(lower, "ng-version=") || strings.Contains(s, "ng-app=") {
		p.add("Angular", "medium", "Angular attributes in HTML", "framework")
	}
	if strings.Contains(lower, "vue.js") || strings.Contains(s, "__vue__") {
		p.add("Vue.js", "medium", "Vue.js signature in HTML", "framework")
	}
	if strings.Contains(lower, "jquery") {
		p.add("jQuery", "low", "jQuery referenced in HTML", "framework")
	}

	// Specific CMS/framework patterns
	if strings.Contains(lower, "powered by ghost") {
		p.add("Ghost CMS", "high", "Ghost CMS signature", "cms")
		p.add("Node.js", "high", "Ghost → Node.js", "language")
	}
	if strings.Contains(lower, "shopify") || strings.Contains(lower, "cdn.shopify.com") {
		p.add("Shopify", "high", "Shopify CDN/signatures in HTML", "cms")
	}
	if strings.Contains(lower, "squarespace") {
		p.add("Squarespace", "high", "Squarespace signature", "cms")
	}
	if strings.Contains(lower, "wix.com") {
		p.add("Wix", "high", "Wix CDN in HTML", "cms")
	}
}

func (p *profiler) probe404(body []byte) {
	s := string(body)
	lower := strings.ToLower(s)
	if strings.Contains(lower, "apache") {
		p.add("Apache", "medium", "Apache signature in 404 page", "server")
	}
	if strings.Contains(lower, "nginx") {
		p.add("Nginx", "medium", "Nginx signature in 404 page", "server")
	}
	if strings.Contains(lower, "internet information services") || strings.Contains(lower, "iis") {
		p.add("IIS", "medium", "IIS signature in 404 page", "server")
	}
	if strings.Contains(lower, "apache tomcat") {
		p.add("Apache Tomcat", "medium", "Tomcat 404 page", "server")
		p.add("Java", "medium", "Tomcat → Java", "language")
	}
	if strings.Contains(lower, "php warning") || strings.Contains(lower, "php error") || strings.Contains(lower, "fatal error") {
		p.add("PHP", "high", "PHP error exposed in 404", "language")
		p.add("PHP Errors Visible", "high", "PHP error messages leaked to client", "security")
	}
	if strings.Contains(lower, "django") || (strings.Contains(lower, "python") && strings.Contains(lower, "traceback")) {
		p.add("Django/Python", "medium", "Django/Python error signature", "framework")
	}
	if strings.Contains(s, ".java:") && strings.Contains(lower, "stacktrace") {
		p.add("Java", "high", "Java stack trace in error response", "language")
	}
	if strings.Contains(lower, "ruby") && strings.Contains(lower, "error") {
		p.add("Ruby", "medium", "Ruby error signature", "language")
	}
	if strings.Contains(lower, "express") && strings.Contains(lower, "stack") {
		p.add("Express.js", "medium", "Express stack trace in error", "framework")
		p.add("Node.js", "medium", "Express.js → Node.js", "language")
	}
}

func (p *profiler) probePhpInfo(resp *http.Response, body []byte) {
	if resp.StatusCode != 200 {
		return
	}
	lower := strings.ToLower(string(body))
	if strings.Contains(lower, "php version") || strings.Contains(lower, "phpinfo()") {
		ver := ""
		if m := regexp.MustCompile(`PHP Version ([\d.]+)`).FindStringSubmatch(string(body)); len(m) > 1 {
			ver = m[1]
		}
		label := "PHP"
		if ver != "" {
			label = fmt.Sprintf("PHP %s", ver)
		}
		p.add(label, "high", "phpinfo() page found", "language")
		p.add("phpinfo() Exposed", "high", "Full PHP config is publicly accessible", "security")
		if strings.Contains(lower, "apache") {
			p.add("Apache", "high", "Detected via phpinfo()", "server")
		}
		if strings.Contains(lower, "mysql") {
			p.add("MySQL", "high", "MySQL extension in phpinfo()", "database")
		}
		if strings.Contains(lower, "postgresql") || strings.Contains(lower, "pgsql") {
			p.add("PostgreSQL", "medium", "PostgreSQL extension in phpinfo()", "database")
		}
		if strings.Contains(lower, "redis") {
			p.add("Redis", "medium", "Redis extension in phpinfo()", "database")
		}
		if strings.Contains(lower, "opcache") {
			p.add("OPcache", "low", "OPcache enabled", "server")
		}
	}
}

func (p *profiler) probeApacheStatus(resp *http.Response, body []byte) {
	if resp.StatusCode != 200 {
		return
	}
	s := string(body)
	if strings.Contains(s, "Apache Server Status") || strings.Contains(s, "requests currently being processed") {
		p.add("Apache", "high", "/server-status exposed", "server")
		p.add("/server-status Exposed", "high", "Apache server-status is publicly accessible", "security")
		if m := regexp.MustCompile(`Apache/([\d.]+)`).FindStringSubmatch(s); len(m) > 1 {
			p.add(fmt.Sprintf("Apache/%s", m[1]), "high", "Version from server-status", "server")
		}
	}
}

func (p *profiler) probeApacheInfo(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 && strings.Contains(string(body), "Apache Server Information") {
		p.add("Apache", "high", "/server-info exposed", "server")
		p.add("/server-info Exposed", "high", "Apache server-info is publicly accessible", "security")
	}
}

func (p *profiler) probeHtaccess(resp *http.Response, body []byte) {
	if resp.StatusCode != 200 || len(body) == 0 {
		return
	}
	lower := strings.ToLower(string(body))
	if strings.Contains(lower, "rewriterule") || strings.Contains(lower, "allowoverride") || strings.Contains(lower, "authtype") {
		p.add("Apache", "high", ".htaccess file exposed", "server")
		p.add(".htaccess Exposed", "high", "Apache .htaccess is publicly readable — may reveal internal rewrite rules", "security")
	}
}

func (p *profiler) probeNginx(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		s := string(body)
		if strings.Contains(s, "Active connections:") || strings.Contains(s, "server accepts") {
			p.add("Nginx", "high", "/nginx_status exposed", "server")
			p.add("/nginx_status Exposed", "high", "Nginx status page is public", "security")
		}
	}
}

func (p *profiler) probeWP(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 || resp.StatusCode == 302 {
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "wordpress") || strings.Contains(lower, "wp-login") || strings.Contains(lower, "wp-content") {
			p.add("WordPress", "high", "WordPress login/admin found", "cms")
			p.add("PHP", "high", "WordPress → PHP", "language")
		}
	}
}

func (p *profiler) probeJoomla(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 && strings.Contains(strings.ToLower(string(body)), "joomla") {
		p.add("Joomla", "high", "/administrator/ found", "cms")
		p.add("PHP", "high", "Joomla → PHP", "language")
	}
}

func (p *profiler) probeDrupal(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		p.add("Drupal", "high", "/sites/default/settings.php exposed", "cms")
		p.add("Drupal Config Exposed", "high", "Drupal settings.php is public", "security")
		p.add("PHP", "high", "Drupal → PHP", "language")
	}
}

func (p *profiler) probeSpring(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		s := string(body)
		if strings.Contains(s, `"status"`) && (strings.Contains(s, `"UP"`) || strings.Contains(s, `"DOWN"`) || strings.Contains(s, "components")) {
			p.add("Spring Boot", "high", "Spring Actuator health endpoint", "framework")
			p.add("Java", "high", "Spring Boot → Java", "language")
			p.add("Spring Actuator Exposed", "high", "/actuator endpoints are public", "security")
		}
	}
}

func (p *profiler) probeElmah(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		p.add("ASP.NET (ELMAH)", "high", "/elmah.axd error log exposed", "framework")
		p.add("ELMAH Exposed", "high", "Error log publicly accessible", "security")
	}
}

func (p *profiler) probeGit(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		s := strings.TrimSpace(string(body))
		if strings.HasPrefix(s, "ref: refs/") {
			p.add("Git Repository Exposed", "high", "/.git/HEAD is public: "+s, "security")
		}
	}
}

func (p *profiler) probeDotEnv(resp *http.Response, body []byte) {
	if resp.StatusCode != 200 {
		return
	}
	s := string(body)
	lower := strings.ToLower(s)
	if strings.Contains(s, "=") && (strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "key") || strings.Contains(lower, "token")) {
		p.add(".env Exposed", "high", "Environment file with credentials is public", "security")
		if strings.Contains(lower, "aws_access_key") {
			p.add("AWS Credentials Exposed", "high", "AWS keys found in .env", "security")
		}
		if strings.Contains(lower, "app_env") || strings.Contains(lower, "laravel") || strings.Contains(lower, "app_key") {
			p.add("Laravel", "medium", "Laravel .env pattern", "framework")
		}
		if strings.Contains(lower, "django") || strings.Contains(lower, "django_secret") {
			p.add("Django", "medium", "Django .env pattern", "framework")
		}
		if strings.Contains(lower, "postgresql") || strings.Contains(lower, "postgres://") {
			p.add("PostgreSQL", "medium", "PostgreSQL in .env", "database")
		}
		if strings.Contains(lower, "mysql") {
			p.add("MySQL", "medium", "MySQL in .env", "database")
		}
		if strings.Contains(lower, "mongodb") || strings.Contains(lower, "mongo_url") {
			p.add("MongoDB", "medium", "MongoDB in .env", "database")
		}
		if strings.Contains(lower, "redis") {
			p.add("Redis", "medium", "Redis in .env", "database")
		}
	}
}

func (p *profiler) probeWebConfig(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "system.web") || strings.Contains(lower, "configuration") {
			p.add("ASP.NET", "high", "/web.config exposed", "framework")
			p.add("IIS", "high", "web.config is an IIS config file", "server")
			p.add("web.config Exposed", "high", "IIS/ASP.NET configuration is public", "security")
		}
	}
}

func (p *profiler) probeJEE(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		p.add("Java EE", "high", "WEB-INF/web.xml exposed", "language")
		p.add("WEB-INF Exposed", "high", "Java deployment descriptor is public", "security")
	}
}

func (p *profiler) probeTomcat(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 || resp.StatusCode == 401 {
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "tomcat manager") || strings.Contains(lower, "application manager") || resp.StatusCode == 401 {
			p.add("Apache Tomcat", "high", "Tomcat manager found at /manager/html", "server")
			p.add("Java", "high", "Tomcat → Java", "language")
			if resp.StatusCode == 200 {
				p.add("Tomcat Manager Unauthenticated", "high", "Tomcat manager accessible without credentials", "security")
			}
		}
	}
}

func (p *profiler) probePhpMyAdmin(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 && strings.Contains(strings.ToLower(string(body)), "phpmyadmin") {
		p.add("phpMyAdmin", "high", "phpMyAdmin found", "database")
		p.add("MySQL", "high", "phpMyAdmin manages MySQL", "database")
		p.add("PHP", "high", "phpMyAdmin → PHP", "language")
	}
}

func (p *profiler) probeAdminer(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 && strings.Contains(strings.ToLower(string(body)), "adminer") {
		p.add("Adminer", "high", "Adminer database panel found", "database")
		p.add("PHP", "high", "Adminer → PHP", "language")
	}
}

func (p *profiler) probeGraphQL(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 || resp.StatusCode == 400 {
		s := string(body)
		if strings.Contains(s, "graphql") || strings.Contains(s, "GraphQL") || strings.Contains(s, "__schema") || strings.Contains(s, "__typename") {
			p.add("GraphQL", "high", "GraphQL endpoint detected", "framework")
		}
	}
}

func (p *profiler) probeGoPprof(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		s := string(body)
		if strings.Contains(s, "goroutine") || strings.Contains(s, "pprof") || strings.Contains(s, "/debug/pprof") {
			p.add("Go", "high", "Go pprof profiler endpoint found", "language")
			p.add("Go pprof Exposed", "high", "/debug/pprof/ is publicly accessible", "security")
		}
	}
}

func (p *profiler) probePrometheus(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		s := string(body)
		if strings.Contains(s, "# HELP") || strings.Contains(s, "# TYPE") {
			p.add("Prometheus Metrics Exposed", "high", "/metrics endpoint is public", "security")
		}
	}
}

func (p *profiler) probeJBoss(resp *http.Response, body []byte) {
	if resp.StatusCode == 200 {
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "jboss") || strings.Contains(lower, "wildfly") || strings.Contains(lower, "jmx") {
			p.add("JBoss/WildFly", "high", "JBoss management console found", "server")
			p.add("Java", "high", "JBoss → Java", "language")
			p.add("JBoss Console Exposed", "high", "Management interface is public", "security")
		}
	}
}

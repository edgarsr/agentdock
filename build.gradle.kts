import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware

plugins {
    id("org.jetbrains.intellij.platform")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization") apply false
    id("rpc") apply false
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

subprojects {
    group = rootProject.group
    version = rootProject.version
    apply(plugin = "org.jetbrains.intellij.platform.module")
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "org.jetbrains.kotlin.plugin.serialization")
    apply(plugin = "rpc")
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdea("2025.3")
        jetbrainsRuntime()
        pluginModule(implementation(project(":shared")))
        pluginModule(implementation(project(":frontend")))
        pluginModule(implementation(project(":backend")))
        pluginModule(implementation(project(":frontend-terminal")))
    }
}

// The root project only assembles the plugin; every source file belongs to a content module.
kotlin {
    jvmToolchain(21)
    sourceSets["main"].kotlin.setSrcDirs(emptyList<String>())
    sourceSets["test"].kotlin.setSrcDirs(emptyList<String>())
}

sourceSets {
    main {
        resources {
            setSrcDirs(listOf("src/main/resources"))
            include("META-INF/plugin.xml")
            include("META-INF/pluginIcon.svg")
            include("META-INF/pluginIcon_dark.svg")
        }
    }
}

intellijPlatform {
    buildSearchableOptions = false
    splitMode = true
    pluginInstallationTarget = SplitModeAware.PluginInstallationTarget.BOTH

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "253"
        }
    }
    signing {
        privateKeyFile.set(layout.projectDirectory.file("signing/private.pem"))
        certificateChainFile.set(layout.projectDirectory.file("signing/chain.crt"))
    }
    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdea, "2025.3")
            create(IntelliJPlatformType.PhpStorm, "2026.1")
            create(IntelliJPlatformType.PhpStorm, "2026.2")
            create(IntelliJPlatformType.IntellijIdea, "261.24374.34")
        }
    }
}

val devMode = providers.gradleProperty("devMode").map { it.toBoolean() }.getOrElse(false)

val generateBuildConfig by tasks.registering {
    val outputDir = layout.buildDirectory.dir("generated/buildConfig")
    val isDev = devMode
    inputs.property("devMode", isDev)
    outputs.dir(outputDir)
    doLast {
        val file = outputDir.get().asFile.resolve("agentdock/BuildConfig.kt")
        file.parentFile.mkdirs()
        // Public rather than internal: both the frontend and the backend content module read it.
        file.writeText("package agentdock\n\nobject BuildConfig {\n    const val IS_DEV: Boolean = $isDev\n}\n")
    }
}

val npm = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "npm.cmd" else "npm"

val npmBuild by tasks.registering(Exec::class) {
    workingDir = file("frontend")
    commandLine(npm, "run", "build")

    inputs.dir("frontend/src")
    inputs.files(
        "frontend/index.html",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/postcss.config.js",
        "frontend/tailwind.config.js",
        "frontend/tsconfig.json",
        "frontend/tsconfig.node.json",
        "frontend/vite.config.ts",
    )
    outputs.dir("src/main/resources/webview")
}

tasks.named<Delete>("clean") {
    delete(layout.projectDirectory.dir("src/main/resources/webview"))
}

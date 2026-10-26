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
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("com.agentclientprotocol:acp:0.34.0") {
        exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-bom")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core-jvm")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-json")
    }
    implementation("io.github.java-diff-utils:java-diff-utils:4.15")

    intellijPlatform {
        intellijIdea("2026.2")
        jetbrainsRuntime()
        pluginModule(implementation(project(":shared")))
        pluginModule(implementation(project(":frontend")))
        pluginModule(implementation(project(":backend")))
        pluginModule(implementation(project(":backend-libraries")))
        pluginModule(implementation(project(":frontend-terminal")))
    }
}

kotlin {
    jvmToolchain(25)
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
    splitMode = false
    pluginInstallationTarget = SplitModeAware.PluginInstallationTarget.BOTH

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "262"
            untilBuild = provider { null }
        }
    }
    signing {
        privateKeyFile.set(layout.projectDirectory.file("signing/private.pem"))
        certificateChainFile.set(layout.projectDirectory.file("signing/chain.crt"))
    }
    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdea, "2026.2")
        }
    }
}

val devMode = providers.gradleProperty("devMode").map { it.toBoolean() }.getOrElse(false)

tasks.register("generateBuildConfig") {
    description = "Generates the BuildConfig object with the dev mode flag and plugin version."
    val outputDir = layout.buildDirectory.dir("generated/buildConfig")
    val isDev = devMode
    val pluginVersion = project.version.toString()
    inputs.property("devMode", isDev)
    inputs.property("pluginVersion", pluginVersion)
    outputs.dir(outputDir)
    doLast {
        val file = outputDir.get().asFile.resolve("agentdock/BuildConfig.kt")
        file.parentFile.mkdirs()
        // Public rather than internal: both the frontend and the backend content module read it.
        file.writeText("package agentdock\n\nobject BuildConfig {\n    const val IS_DEV: Boolean = $isDev\n    const val PLUGIN_VERSION: String = \"$pluginVersion\"\n}\n")
    }
}

val npm = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "npm.cmd" else "npm"

tasks.register<Exec>("npmBuild") {
    description = "Builds the React UI into src/main/resources/webview."
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
